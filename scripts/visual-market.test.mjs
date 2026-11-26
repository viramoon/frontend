import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const origin = 'http://frontend.invalid';
const dist = new URL('../dist/', import.meta.url);
const contentTypes = { js: 'text/javascript', css: 'text/css' };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let responses;
let browser;

before(async () => {
  const index = {
    body: readFileSync(new URL('index.html', dist)),
    contentType: 'text/html',
  };
  responses = new Map([
    ['/dashboard', index],
    ['/options/flow', index],
    ['/options/exposure', index],
    ['/api/v1/system/status', { status: 503 }],
    ['/api/v1/backtests/sample', { status: 404 }],
    ['/favicon.ico', { status: 404 }],
  ]);
  for (const name of readdirSync(new URL('assets/', dist))) {
    const contentType = contentTypes[name.split('.').at(-1)];
    if (contentType) {
      responses.set(`/assets/${name}`, {
        body: readFileSync(new URL(`assets/${name}`, dist)),
        contentType,
      });
    }
  }
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--no-proxy-server'],
  });
});

after(async () => browser?.close());

async function withOfflinePage(viewport, path, exercise) {
  const context = await browser.newContext({
    viewport,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  let unexpectedRequests = 0;
  try {
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const response = responses.get(url.pathname);
      if (url.origin === origin && request.method() === 'GET' && response) {
        await route.fulfill(response);
      } else {
        unexpectedRequests += 1;
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket('**/*', async (socket) => {
      unexpectedRequests += 1;
      await socket.close();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(origin + path);
    await exercise(page);
  } finally {
    await context.close();
    assert.equal(
      unexpectedRequests,
      0,
      'Visual test attempted an unapproved HTTP or WebSocket request',
    );
  }
}

async function withTerminal(viewport, exercise) {
  await withOfflinePage(viewport, '/dashboard', async (page) => {
    const terminal = page.getByRole('region', { name: '行情终端' });
    await terminal.getByRole('heading', { name: 'BTC-USD' }).waitFor();
    assert.equal(
      await terminal.getAttribute('data-fixture-seed'),
      'market-terminal-v1',
    );
    const chart = terminal.getByRole('region', { name: '主 K 线与成交量' });
    await chart.getByText('Fixture · 示例数据').waitFor();
    await chart.locator('canvas').first().waitFor();
    await exercise(page, terminal, chart);
  });
}

async function assertRendered(locator) {
  // Keep the render in memory regardless of the test outcome.
  const png = await locator.screenshot({ animations: 'disabled' });
  assert.ok(png.subarray(0, pngSignature.length).equals(pngSignature));
  assert.ok(png.readUInt32BE(16) > 0);
  assert.ok(png.readUInt32BE(20) > 0);
}

test('desktop chart captures only the seeded synthetic replay', async () => {
  await withTerminal(
    { width: 1440, height: 960 },
    async (_page, terminal, chart) => {
      const quote = terminal.getByRole('complementary', { name: '报价与来源' });
      await quote.getByText('67529.712500', { exact: true }).waitFor();
      await chart.getByRole('button', { name: '4 小时' }).click();
      assert.equal(
        await chart
          .getByRole('button', { name: '4 小时' })
          .getAttribute('aria-pressed'),
        'true',
      );
      await assertRendered(terminal);
    },
  );
});

test('mobile quote drawer captures only the seeded synthetic replay', async () => {
  await withTerminal({ width: 390, height: 844 }, async (page, terminal) => {
    await terminal.getByRole('button', { name: '自选与搜索' }).click();
    await page
      .getByRole('dialog', { name: '自选与搜索' })
      .getByRole('button', { name: /ETH-USD/ })
      .click();
    const opener = terminal.getByRole('button', { name: '报价与深度' });
    await opener.click();
    const drawer = page.getByRole('dialog', { name: '报价与深度' });
    await drawer.getByText('3476.792800', { exact: true }).waitFor();
    await assertRendered(drawer);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(
      await opener.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      ),
      true,
    );
  });
});

test('desktop options routes distinguish observation, verification, hypothesis and OI date above the fold', async () => {
  const viewport = { width: 1440, height: 900 };
  await withOfflinePage(viewport, '/options/flow', async (page) => {
    const summary = page.getByRole('region', { name: '期权数据摘要' });
    for (const route of ['期权流水', '期权敞口']) {
      if (route === '期权敞口')
        await page.getByRole('link', { name: route }).click();
      await page.getByRole('heading', { name: route, exact: true }).waitFor();
      await summary.getByText('Fixture · 示例数据').waitFor();
      assert.equal(
        await summary.locator('..').getAttribute('data-fixture-seed'),
        'options-terminal-v1:1801',
      );
      for (const label of [
        '实时观察 · 待核验',
        '历史逐笔 · 已核验',
        '假设',
        '实测项',
        'OI 基准日',
        '2026-11-18',
      ]) {
        const box = await summary
          .getByText(label, { exact: true })
          .boundingBox();
        assert.ok(
          box && box.y >= 0 && box.y + box.height <= viewport.height,
          label,
        );
      }
    }
    await page
      .getByRole('combobox', { name: '敞口情景' })
      .selectOption('dealerShort');
    await page.getByText('此情景无 flip').waitFor();
    await page
      .getByRole('combobox', { name: '敞口情景' })
      .selectOption('callPositive');
    await page.getByText('314.25', { exact: true }).waitFor();
    await page.getByText('后端情景网格的过零点（当前为合成样例）').waitFor();
    await page.getByText('查看情景网格点', { exact: true }).click();
    const grid = page.getByRole('table', { name: '情景网格点' });
    for (const [spot, gex] of [
      ['314', '-250'],
      ['315', '750'],
    ]) {
      const point = grid.getByRole('rowheader', { name: spot, exact: true });
      assert.equal(
        await point.locator('..').getByRole('cell').textContent(),
        gex,
      );
    }
  });
});

test('mobile options keeps evidence keyboard-accessible and contains wide input tables', async () => {
  await withOfflinePage(
    { width: 390, height: 844 },
    '/options/flow',
    async (page) => {
      const volume = page.locator('summary').filter({ hasText: '累计放量' });
      await volume.focus();
      await page.keyboard.press('Enter');
      await page.getByText(/单笔规模未知/).waitFor();
      await page.getByText('无法回补逐笔').waitFor();
      assert.equal(
        await page.locator('html').evaluate((element) => element.scrollWidth),
        390,
      );
      await page.getByRole('link', { name: '期权敞口' }).click();
      const inputs = page.getByRole('region', {
        name: '合约级 OI、IV 与 gamma',
      });
      await inputs.focus();
      assert.equal(
        await inputs.evaluate(
          (element) => element === element.ownerDocument.activeElement,
        ),
        true,
      );
      assert.equal(
        await inputs.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
        true,
      );
      assert.equal(
        await page.locator('html').evaluate((element) => element.scrollWidth),
        390,
      );
    },
  );
});
