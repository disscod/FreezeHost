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
            console.log('⚠️ TG_BOT 未配置');
            return resolve();
        }

        const msg = [
            `🎮 FreezeHost 续期通知`,
            `🕐 时间: ${nowStr()}`,
            `📊 结果: ${result}`,
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
            console.log(`📨 TG 状态: ${res.statusCode}`);
            resolve();
        });

        req.on('error', (e) => {
            console.log(`⚠️ TG 错误: ${e.message}`);
            resolve();
        });

        req.write(body);
        req.end();
    });
}

async function getOAuthCallback(DISCORD_TOKEN) {

    console.log('🔑 使用 Discord Token 调用 OAuth2 授权接口...');

    const authURL =
        'https://discord.com/api/v9/oauth2/authorize?' +
        new URLSearchParams({
            client_id: '1282067735378577429',
            response_type: 'code',
            redirect_uri: 'https://free.freezehost.pro/callback',
            scope: 'identify guilds email',
        }).toString();

    const response = await fetch(authURL, {
        method: 'POST',
        headers: {
            authorization: DISCORD_TOKEN,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            permissions: '0',
            authorize: true,
        }),
    });

    console.log(`📡 Discord OAuth2 响应状态: ${response.status}`);

    if (!response.ok) {
        throw new Error(`Discord OAuth2 失败: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.location) {
        console.log(data);
        throw new Error('❌ 未获取到 OAuth2 callback URL');
    }

    console.log(`✅ 拿到回调 URL: ${data.location}`);

    return data.location;
}

async function getAllServers(page) {

    const servers = await page.evaluate(() => {

        const links = Array.from(
            document.querySelectorAll('a[href*="server-console"]')
        );

        return links.map(link => {

            const href = link.href;

            const parent =
                link.closest('div') || document.body;

            const text =
                parent.innerText || '';

            const lines =
                text.split('\n').map(s => s.trim()).filter(Boolean);

            const name =
                lines[0] || 'Unknown';

            return {
                name,
                url: href,
                id: new URL(href).searchParams.get('id'),
            };
        });

    });

    return servers;
}

async function processServer(page, server) {

    console.log('');
    console.log('────────────────────────────');
    console.log(`🖥 处理服务器 ID: ${server.id}`);
    console.log('────────────────────────────');
    console.log('');

    await page.goto(server.url, {
        waitUntil: 'domcontentloaded',
    });

    console.log(`✅ 已跳转: ${server.url}`);
    console.log(`🏷 服务器名称: ${server.name}`);

    await page.waitForTimeout(3000);

    console.log('🔍 读取续期状态...');

    const renewalStatusText = await page.evaluate(() => {

        const el =
            document.getElementById('renewal-status-console');

        return el ? el.innerText.trim() : null;

    });

    console.log(`📋 续期状态: ${renewalStatusText}`);

    if (!renewalStatusText) {

        console.log('⚠️ 未读取到续期状态');

        await sendTG(`⚠️ ${server.name} 未读取到续期状态`);

        return;
    }

    const daysMatch =
        renewalStatusText.match(/(\d+(?:\.\d+)?)\s*day/i);

    const remainingDays =
        daysMatch ? parseFloat(daysMatch[1]) : null;

    if (remainingDays === null) {

        console.log('⚠️ 无法解析剩余天数');

        await sendTG(`⚠️ ${server.name} 无法解析剩余天数`);

        return;
    }

    console.log(`⏳ 剩余天数: ${remainingDays}`);

    // 超过 7 天直接跳过
    if (remainingDays > 7) {

        console.log(`❤️ 剩余 ${remainingDays} 天，无需续期`);

        await sendTG(
            `❤️ ${server.name}\n剩余 ${remainingDays} 天，无需续期`
        );

        return;
    }

    console.log('🚀 准备续期...');

    // 打开续期弹窗
    const externalLinkIcon =
        page.locator('i.fa-external-link-alt').first();

    const parentEl =
        externalLinkIcon.locator('xpath=..');

    await parentEl.hover();

    await page.waitForTimeout(1000);

    await externalLinkIcon.click({
        force: true,
    });

    await page.waitForTimeout(2000);

    // 找按钮
    const renewBtn =
        page.locator('#renew-link-modal');

    await renewBtn.waitFor({
        state: 'visible',
        timeout: 10000,
    });

    const btnText =
        (await renewBtn.innerText()).trim();

    console.log(`📋 按钮状态: ${btnText}`);

    if (!btnText.toLowerCase().includes('renew instance')) {

        console.log('⏰ 当前不可续期');

        await sendTG(
            `⏰ ${server.name}\n当前不可续期`
        );

        return;
    }

    const renewHref =
        await renewBtn.getAttribute('href');

    if (!renewHref || renewHref === '#') {
        throw new Error('❌ renew href 无效');
    }

    const renewURL =
        new URL(renewHref, page.url()).href;

    console.log(`🚀 开始续期: ${renewURL}`);

    await page.goto(renewURL, {
        waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(3000);

    const finalUrl = page.url();

    console.log(`📋 最终 URL: ${finalUrl}`);

    if (finalUrl.includes('success=RENEWED')) {

        console.log('🎉 续期成功');

        await sendTG(
            `✅ ${server.name}\n续期成功`
        );

    } else if (
        finalUrl.includes('err=CANNOTAFFORDRENEWAL')
    ) {

        console.log('⚠️ 金币不足');

        await sendTG(
            `⚠️ ${server.name}\n金币不足`
        );

    } else if (
        finalUrl.includes('err=TOOEARLY')
    ) {

        console.log('⏰ 尚未到时间');

        await sendTG(
            `⏰ ${server.name}\n尚未到续期时间`
        );

    } else {

        console.log(`⚠️ 未知结果: ${finalUrl}`);

        await sendTG(
            `⚠️ ${server.name}\n未知结果`
        );
    }
}

test('FreezeHost 自动续期', async () => {

    if (!DISCORD_TOKEN) {
        throw new Error('❌ 缺少 DISCORD_TOKEN');
    }

    let proxyConfig = undefined;

    // 检测 GOST
    if (process.env.GOST_PROXY) {

        try {

            const http = require('http');

            await new Promise((resolve, reject) => {

                const req = http.request(
                    {
                        host: '127.0.0.1',
                        port: 8080,
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

            console.log('🛡️ 本地代理连通，使用 GOST 转发');

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

    console.log('🚀 浏览器就绪！');

    try {

        // ─────────────────────────────
        // IP 检测
        // ─────────────────────────────

        console.log('🌐 验证出口 IP...');

        try {

            const res = await page.goto(
                'https://api.ipify.org?format=json',
                {
                    waitUntil: 'domcontentloaded',
                }
            );

            const body = await res.text();

            const ip =
                JSON.parse(body).ip || body;

            const masked =
                ip.replace(
                    /(\d+\.\d+\.\d+\.)\d+/,
                    '$1xx'
                );

            console.log(`✅ 出口 IP 确认: ${masked}`);

        } catch {

            console.log('⚠️ IP 验证失败');
        }

        // ─────────────────────────────
        // OAuth2 获取 callback
        // ─────────────────────────────

        const callbackURL =
            await getOAuthCallback(DISCORD_TOKEN);

        // ─────────────────────────────
        // 建立 FreezeHost Session
        // ─────────────────────────────

        console.log('🌐 浏览器访问回调 URL，建立登录 Session...');

        await page.goto(callbackURL, {
            waitUntil: 'domcontentloaded',
        });

        console.log(`📍 当前 URL: ${page.url()}`);

        await page.waitForTimeout(5000);

        if (!page.url().includes('/dashboard')) {
            throw new Error('❌ 登录 Session 建立失败');
        }

        console.log('✅ 登录 Session 建立成功');

        console.log(`✅ 登录成功! 当前: ${page.url()}`);

        // ─────────────────────────────
        // 获取所有服务器
        // ─────────────────────────────

        const servers = await getAllServers(page);

        if (!servers.length) {
            throw new Error('❌ 未发现服务器');
        }

        console.log(`📦 共发现 ${servers.length} 台服务器`);

        // ─────────────────────────────
        // 遍历处理
        // ─────────────────────────────

        for (const server of servers) {

            try {

                await processServer(page, server);

            } catch (e) {

                console.log(`❌ 服务器处理失败: ${e.message}`);

                await sendTG(
                    `❌ ${server.name}\n${e.message}`
                );
            }
        }

    } catch (e) {

        console.log(`❌ 脚本异常: ${e.message}`);

        await sendTG(`❌ 脚本异常\n${e.message}`);

        throw e;

    } finally {

        await browser.close();
    }
});
