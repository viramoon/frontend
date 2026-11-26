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
  responses = new Map([
    [
      '/dashboard',
      {
        body: readFileSync(new URL('index.html', dist)),
        contentType: 'text/html',
      },
    ],
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

async function withTerminal(viewport, exercise) {
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
    await page.goto(`${origin}/dashboard`);
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
  } finally {
    await context.close();
    assert.equal(
      unexpectedRequests,
      0,
      'Visual test attempted an unapproved HTTP or WebSocket request',
    );
  }
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

test('mobile depth drawer explains dates before synthetic collection', async () => {
  await withTerminal({ width: 390, height: 844 }, async (page, terminal) => {
    await terminal.getByLabel('起始日期').fill('2026-11-16');
    await terminal.getByLabel('结束日期（不含）').fill('2026-11-17');
    await terminal.getByRole('button', { name: '报价与深度' }).click();
    const drawer = page.getByRole('dialog', { name: '报价与深度' });
    const depth = drawer.getByRole('region', { name: '盘口深度' });
    await depth.getByText('采集开始前无细节数据', { exact: true }).waitFor();
    await depth.getByText('2026-11-17', { exact: true }).waitFor();
    assert.equal(await depth.getByRole('table').count(), 0);
    await drawer.getByRole('table', { name: 'L1 最优报价' }).waitFor();
  });
});
