import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const audioMocks = readFileSync(join(__dirname, 'fixtures/audio-mocks.js'), 'utf8');

const SSE_RESERVATION = [
  { type: 'delta', text: 'かしこまりました。ご希望の日付を教えてください。' },
  { type: 'done', model: 'stub' },
]
  .map((e) => `data: ${JSON.stringify(e)}\n\n`)
  .join('');

// ── ヘルパー ──────────────────────────────────────────────────────────────────

async function startCall(page: import('@playwright/test').Page) {
  await page.click('button:has-text("通話を開始")');
  // speak() が同期で呼ばれ ttsBusy=true になるまで待つ
  await page.waitForTimeout(20);
}

/** 挨拶 2 文を最後まで再生 (onend を手動トリガー) */
async function finishGreeting(page: import('@playwright/test').Page) {
  // onstart が発火してから onend を呼ぶ
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__finishSpeech());
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__finishSpeech());
  await page.waitForTimeout(30);
}

// ── テスト ────────────────────────────────────────────────────────────────────

test.describe('割り込み (認識テキスト駆動)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: audioMocks });
    await page.goto('/');
  });

  test('挨拶読み上げ中の発話で挨拶を打ち切ってその発話に応答する', async ({ page }) => {
    await page.route('/api/chat', (route) => {
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: SSE_RESERVATION,
      });
    });

    await startCall(page);
    // 挨拶 1 文目の onstart 後、読み上げ中に発話
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__emitSpeech('予約をお願いします'));

    await expect(page.getByText('予約をお願いします')).toBeVisible({ timeout: 2000 });
    const cancelled = await page.evaluate(() => window.__synthesisCancelled);
    expect(cancelled).toBeGreaterThan(0);
  });

  test('応答読み上げ中にユーザー発話が認識されると残りを打ち切ってその発話を処理する', async ({
    page,
  }) => {
    let chatCalls = 0;
    await page.route('/api/chat', (route) => {
      chatCalls += 1;
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: SSE_RESERVATION,
      });
    });

    await startCall(page);
    await finishGreeting(page);

    await page.evaluate(() => window.__emitSpeech('予約をお願いします'));
    await expect(page.getByText('応答中 (話しかけると中断)')).toBeVisible({ timeout: 3000 });

    // 応答開始直後の遅延結果ガード (600ms) を越えてから割り込む
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__emitSpeech('明日でお願いします'));

    await expect(page.getByText('明日でお願いします')).toBeVisible({ timeout: 2000 });
    const cancelled = await page.evaluate(() => window.__synthesisCancelled);
    expect(cancelled).toBeGreaterThan(0);
    expect(chatCalls).toBe(2);
  });

  test('応答開始直後に届く認識テキスト (直前発話の遅延結果) では読み上げを止めない', async ({
    page,
  }) => {
    await page.route('/api/chat', (route) => {
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: SSE_RESERVATION,
      });
    });

    await startCall(page);
    await finishGreeting(page);

    await page.evaluate(() => window.__emitSpeech('予約をお願いします'));
    await expect(page.getByText('応答中 (話しかけると中断)')).toBeVisible({ timeout: 3000 });

    // ガード時間内に届いた遅延認識テキスト
    await page.evaluate(() => window.__emitSpeech('お願いします', false));
    await page.waitForTimeout(100);

    const cancelled = await page.evaluate(() => window.__synthesisCancelled);
    expect(cancelled).toBe(0);
    await expect(page.getByText('応答中 (話しかけると中断)')).toBeVisible();
  });
});
