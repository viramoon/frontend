import { posix } from 'node:path';
import { load } from 'js-yaml';

const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const action = /(?:^|\/)action\.ya?ml$/;
const artifactUpload = /^actions\/upload-(?:artifact|release-asset)(?=[/@]|$)/i;
const maxLocalDepth = 8;

export function isActionDefinition(path) {
  return workflow.test(path) || action.test(path);
}

function isMapping(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function actionReferences(path, content) {
  const document = load(content, { maxDepth: 64 });
  if (!isMapping(document)) throw new Error('Expected a YAML mapping');
  if (workflow.test(path)) {
    if (!isMapping(document.jobs) && !Array.isArray(document.steps)) {
      throw new Error('Expected workflow jobs');
    }
  } else if (
    typeof document.runs?.using !== 'string' ||
    (document.runs.using === 'composite' && !Array.isArray(document.runs.steps))
  ) {
    throw new Error('Expected action runs');
  }

  const refs = [];
  function add(uses, kind) {
    if (typeof uses === 'string') refs.push({ uses: uses.trim(), kind });
  }
  function addSteps(steps) {
    if (!Array.isArray(steps)) return;
    for (const step of steps) add(step?.uses, 'action');
  }

  addSteps(document.steps);
  addSteps(document.runs?.steps);
  for (const job of Object.values(document.jobs ?? {})) {
    add(job?.uses, 'workflow');
    addSteps(job?.steps);
  }
  const triggers = document.on;
  const reusable =
    triggers === 'workflow_call' ||
    (Array.isArray(triggers) && triggers.includes('workflow_call')) ||
    (isMapping(triggers) && Object.hasOwn(triggers, 'workflow_call'));
  return { refs, reusable };
}

function localDefinition({ uses, kind }, definitions) {
  const path = posix.normalize(uses.slice(2));
  if (
    path === '..' ||
    path.startsWith('../') ||
    posix.isAbsolute(path) ||
    uses.includes('\\')
  ) {
    return undefined;
  }

  if (kind === 'workflow') {
    return workflow.test(path) && definitions.get(path)?.reusable
      ? path
      : undefined;
  }

  const candidates = ['action.yml', 'action.yaml']
    .map((name) => posix.join(path, name))
    .filter((name) => definitions.has(name));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function checkActionReferences(definitions, report) {
  const links = new Map();
  for (const [path, { refs }] of definitions) {
    const targets = [];
    for (const ref of refs) {
      if (artifactUpload.test(ref.uses)) report(path, 'artifact-upload');
      if (ref.uses.startsWith('./')) {
        const target = localDefinition(ref, definitions);
        if (target) targets.push(target);
        else report(path, 'local-action-reference');
      }
    }
    links.set(path, targets);
  }

  const checked = new Map();
  const active = new Set();
  function resolves(path, remaining) {
    if (remaining < 0 || active.has(path)) return false;
    const key = `${remaining} ${path}`;
    if (checked.has(key)) return checked.get(key);

    active.add(path);
    const result = links
      .get(path)
      .every((target) => resolves(target, remaining - 1));
    active.delete(path);
    checked.set(key, result);
    return result;
  }

  for (const path of links.keys()) {
    if (!resolves(path, maxLocalDepth)) report(path, 'local-action-depth');
  }
}
