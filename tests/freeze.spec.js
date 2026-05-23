// tests/freeze.spec.js
const { test, expect, chromium } = require('@playwright/test');
const https = require('https');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');

const TIMEOUT = 60000;

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
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

        const body = JSON.stringify({
            chat_id: TG_CHAT_ID,
            text: msg,
        });

        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

async function handleOAuthPage(page) {
    console.log(`📄 当前 URL: ${page.url()}`);

    await page.waitForTimeout(3000);

    const selectors = [
        'button:has-text("Authorize")',
        'button:has-text("授权")',
        'button[type="submit"]',
        'div[class*="footer"] button',
        'button[class*="primary"]',
    ];

    for (let i = 0; i < 8; i++) {
        console.log(`🔄 OAuth 尝试 ${i + 1}`);

        if (!page.url().includes('discord.com')) {
            console.log('✅ 已离开 Discord');
            return;
        }

        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });

        await page.waitForTimeout(1000);

        for (const selector of selectors) {
            try {
                const btn = page.locator(selector).last();

                if (!(await btn.isVisible())) continue;

                const text = (await btn.innerText()).trim();

                console.log(`🔘 找到按钮: ${text}`);

                if (
                    text.includes('取消') ||
                    text.toLowerCase().includes('cancel') ||
                    text.toLowerCase().includes('deny')
                ) {
                    continue;
                }

                if (await btn.isDisabled()) {
                    console.log('⏳ 按钮 disabled');
                    continue;
                }

                await btn.click();

                console.log(`✅ 已点击: ${text}`);

                await page.waitForTimeout(3000);

                if (!page.url().includes('discord.com')) {
                    console.log('✅ OAuth 授权完成');
                    return;
                }

            } catch {
                continue;
            }
        }

        await page.waitForTimeout(2000);
    }

    console.log(`⚠️ OAuth 结束，当前 URL: ${page.url()}`);
}

test('FreezeHost 自动续期', async () => {

    if (!DISCORD_TOKEN) {
        throw new Error('❌ 缺少 DISCORD_TOKEN');
    }

    let proxyConfig = undefined;

    if (process.env.GOST_PROXY) {
        try {
            const http = require('http');

            await new Promise((resolve, reject) => {
                const req = http.request(
                    {
                        host: '127.0.0.1',
                        port: 8080,
                        path: '/',
                        method: 'GET',
                        timeout: 3000,
                    },
                    () => resolve()
                );

                req.on('error', reject);

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('timeout'));
                });

                req.end();
            });

            proxyConfig = {
                server: process.env.GOST_PROXY,
            };

            console.log('🛡️ GOST 代理可用');

        } catch {
            console.log('⚠️ GOST 不可用，降级直连');
        }
    }

    console.log('🔧 启动浏览器...');

    const browser = await chromium.launch({
        headless: true,
        proxy: proxyConfig,
    });

    const context = await browser.newContext();

    const page = await context.newPage();

    page.setDefaultTimeout(TIMEOUT);

    console.log('🚀 浏览器启动完成');

    try {

        // ─────────────────────────────
        // Token 登录 Discord
        // ─────────────────────────────

        console.log('🔑 打开 Discord 登录页...');

        await page.goto('https://discord.com/login', {
            waitUntil: 'domcontentloaded',
        });

        console.log('💉 注入 Discord Token...');

        await page.evaluate((token) => {

            function login(token) {

                setInterval(() => {

                    document.body.appendChild(
                        document.createElement('iframe')
                    ).contentWindow.localStorage.token = `"${token}"`;

                }, 50);

                setTimeout(() => {
                    location.reload();
                }, 2500);
            }

            login(token);

        }, DISCORD_TOKEN);

        console.log('⏳ 等待登录完成...');

        await page.waitForTimeout(7000);

        if (page.url().includes('/login')) {
            throw new Error('❌ Discord Token 登录失败');
        }

        console.log('✅ Discord Token 登录成功');

        // ─────────────────────────────
        // 打开 FreezeHost
        // ─────────────────────────────

        console.log('🌐 打开 FreezeHost...');

        await page.goto('https://free.freezehost.pro', {
            waitUntil: 'domcontentloaded',
        });

        console.log('📤 点击 Login with Discord...');

        await page.click('span.text-lg:has-text("Login with Discord")');

        console.log('⏳ 等待服务条款...');

        const confirmBtn = page.locator('button#confirm-login');

        await confirmBtn.waitFor({
            state: 'visible',
        });

        await confirmBtn.click();

        console.log('✅ 已接受服务条款');

        // ─────────────────────────────
        // OAuth 授权
        // ─────────────────────────────

        console.log('⏳ 等待 OAuth...');

        try {

            await page.waitForURL(
                /discord\.com\/oauth2\/authorize/,
                {
                    timeout: 15000,
                }
            );

            console.log('🔍 进入 OAuth');

            await handleOAuthPage(page);

            await page.waitForURL(
                /free\.freezehost\.pro/,
                {
                    timeout: 20000,
                }
            );

        } catch {
            console.log(`✅ 已自动授权: ${page.url()}`);
        }

        // ─────────────────────────────
        // Dashboard
        // ─────────────────────────────

        console.log('⏳ 等待 Dashboard...');

        try {

            await page.waitForURL(
                url =>
                    url.includes('/dashboard') ||
                    url.includes('/callback'),
                {
                    timeout: 15000,
                }
            );

        } catch {}

        if (page.url().includes('/callback')) {

            await page.waitForURL(
                /free\.freezehost\.pro\/dashboard/,
                {
                    timeout: 20000,
                }
            );
        }

        if (!page.url().includes('/dashboard')) {
            throw new Error(`❌ 未进入 Dashboard: ${page.url()}`);
        }

        console.log(`✅ 已登录 FreezeHost`);

        // ─────────────────────────────
        // 进入控制台
        // ─────────────────────────────

        console.log('🔍 查找 server-console...');

        await page.waitForTimeout(3000);

        const serverUrl = await page.evaluate(() => {
            const link = document.querySelector(
                'a[href*="server-console"]'
            );

            return link ? link.href : null;
        });

        if (!serverUrl) {
            throw new Error('❌ 未找到 server-console');
        }

        console.log(`✅ 找到控制台: ${serverUrl}`);

        await page.goto(serverUrl, {
            waitUntil: 'domcontentloaded',
        });

        // ─────────────────────────────
        // 读取续期状态
        // ─────────────────────────────

        console.log('🔍 检查续期状态...');

        await page.waitForTimeout(3000);

        const renewalStatusText = await page.evaluate(() => {

            const el = document.getElementById(
                'renewal-status-console'
            );

            return el ? el.innerText.trim() : null;

        });

        console.log(`📋 状态: ${renewalStatusText}`);

        if (renewalStatusText) {

            const daysMatch =
                renewalStatusText.match(/(\d+(?:\.\d+)?)\s*day/i);

            const remainingDays =
                daysMatch ? parseFloat(daysMatch[1]) : null;

            if (remainingDays !== null) {

                console.log(`⏳ 剩余 ${remainingDays} 天`);

                if (remainingDays > 7) {

                    const msg =
                        `⏰ 剩余 ${remainingDays} 天，无需续期`;

                    console.log(msg);

                    await sendTG(msg);

                    return;
                }
            }
        }

        // ─────────────────────────────
        // 打开续期弹窗
        // ─────────────────────────────

        console.log('🔍 打开续期弹窗...');

        const externalLinkIcon =
            page.locator('i.fa-external-link-alt').first();

        const parentEl =
            externalLinkIcon.locator('xpath=..');

        await parentEl.waitFor({
            state: 'visible',
            timeout: 10000,
        });

        await parentEl.hover();

        await page.waitForTimeout(1000);

        await externalLinkIcon.click({
            force: true,
        });

        await page.waitForTimeout(2000);

        // ─────────────────────────────
        // 检查按钮
        // ─────────────────────────────

        const renewModalBtn =
            page.locator('#renew-link-modal');

        await renewModalBtn.waitFor({
            state: 'visible',
            timeout: 10000,
        });

        const btnText =
            (await renewModalBtn.innerText()).trim();

        console.log(`📋 按钮文字: ${btnText}`);

        if (!btnText.toLowerCase().includes('renew instance')) {

            console.log('⏰ 暂不可续期');

            await sendTG(
                '⏰ 今日已续期或尚未到时间'
            );

            return;
        }

        // ─────────────────────────────
        // 点击续期
        // ─────────────────────────────

        const renewHref =
            await renewModalBtn.getAttribute('href');

        if (!renewHref || renewHref === '#') {
            throw new Error('❌ renew href 无效');
        }

        const renewAbsUrl =
            new URL(renewHref, page.url()).href;

        console.log(`🚀 跳转续期: ${renewAbsUrl}`);

        await page.goto(renewAbsUrl, {
            waitUntil: 'domcontentloaded',
        });

        await page.waitForURL(
            url =>
                url.toString().includes('/dashboard') ||
                url.toString().includes('/server-console'),
            {
                timeout: 30000,
            }
        );

        const finalUrl = page.url();

        console.log(`📋 最终 URL: ${finalUrl}`);

        // ─────────────────────────────
        // 结果判断
        // ─────────────────────────────

        if (finalUrl.includes('success=RENEWED')) {

            console.log('🎉 续期成功');

            await sendTG('✅ 续期成功');

            expect(finalUrl).toContain('success=RENEWED');

        } else if (
            finalUrl.includes('err=CANNOTAFFORDRENEWAL')
        ) {

            console.log('⚠️ 余额不足');

            await sendTG(
                '⚠️ 余额不足，请挂机获取金币'
            );

            test.skip(true, '余额不足');

        } else if (
            finalUrl.includes('err=TOOEARLY')
        ) {

            console.log('⏰ 尚未到时间');

            await sendTG(
                '⏰ 今日已续期或尚未到时间'
            );

        } else {

            await sendTG(
                `⚠️ 未知结果: ${finalUrl}`
            );

            throw new Error(
                `❌ 未知结果: ${finalUrl}`
            );
        }

    } catch (e) {

        if (!e.message?.includes('余额不足')) {

            await sendTG(
                `❌ 脚本异常：${e.message}`
            );
        }

        throw e;

    } finally {

        await browser.close();
    }
});
