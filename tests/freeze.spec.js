// tests/freeze.spec.js
const { test, expect, chromium } = require('@playwright/test');
const https = require('https');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');

const TIMEOUT = 60000;

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sendTG(result) {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }

        const msg = [
            `🎮 FreezeHost 续期通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: FreezeHost Free`,
            `📊 续期结果: ${result}`,
        ].join('\n');

        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            if (res.statusCode === 200) {
                console.log('📨 TG 推送成功');
            } else {
                console.log(`⚠️ TG 推送失败：HTTP ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            console.log(`⚠️ TG 推送异常：${e.message}`);
            resolve();
        });

        req.setTimeout(15000, () => {
            console.log('⚠️ TG 推送超时');
            req.destroy();
            resolve();
        });

        req.write(body);
        req.end();
    });
}

test('FreezeHost 自动续期', async () => {
    if (!DISCORD_TOKEN) {
        throw new Error('❌ 缺少 DISCORD_TOKEN，请在 .env 文件中设置');
    }

    console.log('🔧 启动浏览器...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);

    try {
        console.log('📥 正在注入 Discord Token...');

        await page.goto('https://discord.com/app', { waitUntil: 'domcontentloaded' });

        // 注入 Token
        await page.evaluate((token) => {
            localStorage.setItem('token', `"${token}"`);
        }, DISCORD_TOKEN);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);

        console.log('🔑 尝试访问 FreezeHost...');
        await page.goto('https://free.freezehost.pro', { waitUntil: 'domcontentloaded' });

        // 检查是否登录成功
        if (page.url().includes('/login') || await page.locator('span:text("Login with Discord")').count() > 0) {
            throw new Error('❌ Token 失效或注入失败，请检查 Token 是否正确且未过期');
        }

        console.log('✅ Token 登录成功！');

        // ── 进入 Dashboard ─────────────────────────────────────
        console.log('⏳ 确认进入 Dashboard...');
        await page.waitForURL(/dashboard|server-console|callback/, { timeout: 15000 });

        if (page.url().includes('/callback')) {
            await page.waitForURL(/dashboard/, { timeout: 10000 });
        }

        // ── 进入 Server Console ───────────────────────────────
        console.log('🔍 查找 Server Console 链接...');
        await page.waitForTimeout(3000);

        const serverUrl = await page.evaluate(() => {
            const link = document.querySelector('a[href*="server-console"]');
            return link ? link.href : null;
        });

        if (!serverUrl) {
            throw new Error('❌ 未找到 server-console 链接');
        }

        console.log(`✅ 找到链接：${serverUrl}`);
        await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
        console.log(`✅ 已进入 Server Console`);

        // ── 检查剩余时间 ───────────────────────────────
        console.log('🔍 读取续期状态...');
        await page.waitForTimeout(3000);

        const renewalStatusText = await page.evaluate(() => {
            const el = document.getElementById('renewal-status-console');
            return el ? el.innerText.trim() : null;
        });

        console.log(`📋 续期状态：${renewalStatusText || '未找到'}`);

        if (renewalStatusText) {
            const daysMatch = renewalStatusText.match(/(\d+(?:\.\d+)?)\s*day/i);
            const remainingDays = daysMatch ? parseFloat(daysMatch[1]) : null;

            if (remainingDays !== null && remainingDays > 7) {
                const msg = `⏰ 剩余 ${remainingDays} 天，无需续期`;
                console.log(msg);
                await sendTG(msg);
                return;
            }
        }

        // ── 点击续期按钮 ───────────────────────────────
        console.log('🔍 查找续期按钮...');
        const externalLinkIcon = page.locator('i.fa-external-link-alt').first();
        const parentEl = externalLinkIcon.locator('xpath=..');

        await parentEl.waitFor({ state: 'visible', timeout: 10000 });
        await parentEl.hover();
        await page.waitForTimeout(1000);
        await externalLinkIcon.click({ force: true });
        console.log('✅ 已点击续期图标');

        await page.waitForTimeout(2000);

        const renewModalBtn = page.locator('#renew-link-modal');
        await renewModalBtn.waitFor({ state: 'visible', timeout: 10000 });

        const btnText = (await renewModalBtn.innerText()).trim();
        console.log(`📋 按钮文字：${btnText}`);

        if (!btnText.toLowerCase().includes('renew')) {
            await sendTG('⏰ 尚未到续期时间');
            return;
        }

        const renewHref = await renewModalBtn.getAttribute('href');
        const renewAbsUrl = new URL(renewHref, page.url()).href;

        console.log(`✅ 跳转续期：${renewAbsUrl}`);
        await page.goto(renewAbsUrl, { waitUntil: 'domcontentloaded' });

        await page.waitForURL(url => 
            url.includes('/dashboard') || url.includes('/server-console'), 
            { timeout: 30000 }
        );

        const finalUrl = page.url();

        // ── 判断结果 ───────────────────────────────
        if (finalUrl.includes('success=RENEWED')) {
            console.log('🎉 续期成功！');
            await sendTG('✅ 续期成功！');
        } else if (finalUrl.includes('err=CANNOTAFFORDRENEWAL')) {
            console.log('⚠️ 余额不足');
            await sendTG('⚠️ 余额不足，请挂机赚金币');
        } else if (finalUrl.includes('err=TOOEARLY')) {
            console.log('⏰ 续期太早');
            await sendTG('⏰ 尚未到续期时间');
        } else {
            await sendTG(`⚠️ 结果未知：${finalUrl}`);
        }

    } catch (e) {
        if (!e.message.includes('无需续期') && !e.message.includes('尚未到续期时间')) {
            await sendTG(`❌ 脚本异常：${e.message}`);
        }
        console.error(e);
        throw e;
    } finally {
        await browser.close();
    }
});
