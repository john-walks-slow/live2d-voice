#!/usr/bin/env node
// live2d-voice — one command to a standalone Live2D voice companion.
// Scaffolds a private data dir (DSH_HOME), installs the minimal dsh web
// profile, boots `dsh web`, and opens the session picker in a browser.

import { spawn } from "node:child_process";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERSION = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8"),
).version;

const DEFAULT_PORT = 43110;

// ── scaffold templates ────────────────────────────────────────────────────

const SETTINGS_YAML = `\
# live2d-voice · 模型 provider 配置（DeepSeek 官方 API，OpenAI 兼容）
# API key 不写在这里 —— 写在数据目录下的 .env（LIVE2D_VOICE_API_KEY）。
llm-pi-ai:
  providers:
    deepseek:
      api: openai-completions
      baseURL: https://api.deepseek.com/v1
      apiKeyEnv: LIVE2D_VOICE_API_KEY
      displayName: DeepSeek
`;

const CORDIS_YML = `\
# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;

const ENV_TEMPLATE = `\
# live2d-voice 环境变量（launcher 启动时自动注入子进程）
# DeepSeek API key：https://platform.deepseek.com/ 申请后填到下一行（去掉行首 #）
# LIVE2D_VOICE_API_KEY=sk-xxxxxxxxxxxxxxxx
`;

function profilePackageJson() {
	return (
		JSON.stringify(
			{
				name: "live2d-voice-web",
				private: true,
				dsh: {
					profile: {
						bundles: [
							"@deepseek-ai/dsh-base",
							"@deepseek-ai/dsh-web-app",
							"dsh-live2d-voice",
						],
					},
				},
				dependencies: {
					"@deepseek-ai/dsh-base": "0.1.5-rc.3",
					"@deepseek-ai/dsh-web-app": "0.1.5-rc.3",
					"dsh-live2d-voice": "^1.6.0",
				},
				// pnpm v10 blocks postinstall scripts by default; allow the ones
				// the dsh runtime needs (dsh-subprocess-local restores the exec
				// bit on node-pty's prebuilt spawn-helper).
				pnpm: {
					onlyBuiltDependencies: [
						"@deepseek-ai/dsh-subprocess-local",
						"@google/genai",
						"koffi",
						"node-pty",
						"protobufjs",
					],
				},
			},
			null,
			2,
		) + "\n"
	);
}

// ── small helpers ─────────────────────────────────────────────────────────

function pkgRoot(name) {
	try {
		return dirname(require.resolve(`${name}/package.json`));
	} catch {
		// package.json not exported — walk up from the main entry
		let dir = dirname(require.resolve(name));
		for (let i = 0; i < 5; i++) {
			if (existsSync(join(dir, "package.json"))) return dir;
			dir = dirname(dir);
		}
	}
	throw new Error(`找不到依赖包 cannot locate package: ${name}`);
}

function binScript(name) {
	const root = pkgRoot(name);
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const b = pkg.bin;
	const rel = typeof b === "string" ? b : b?.[name] ?? Object.values(b ?? {})[0];
	if (!rel) throw new Error(`包 ${name} 没有 bin 入口`);
	return join(root, rel);
}

function loadEnvFile(file) {
	const env = {};
	if (!existsSync(file)) return env;
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2];
		if (
			(v.startsWith('"') && v.endsWith('"')) ||
			(v.startsWith("'") && v.endsWith("'"))
		) {
			v = v.slice(1, -1);
		}
		env[m[1]] = v;
	}
	return env;
}

function isFree(port) {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.once("error", () => resolve(false));
		srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
	});
}

async function pickPort(start) {
	for (let p = start; p < start + 20; p++) {
		if (await isFree(p)) return p;
	}
	throw new Error(`端口 ${start}-${start + 19} 均被占用 no free port`);
}

function run(cmd, args, opts = {}) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: "inherit", ...opts });
		p.on("error", reject);
		p.on("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} → exit ${code}`)),
		);
	});
}

function probe(url) {
	return new Promise((resolve) => {
		const req = httpGet(url, { timeout: 2000 }, (res) => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on("error", () => resolve(false));
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
	});
}

function openBrowser(url) {
	const plat = platform();
	const cmd = plat === "win32" ? "cmd" : plat === "darwin" ? "open" : "xdg-open";
	const args = plat === "win32" ? ["/c", "start", "", url] : [url];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
	} catch {
		// no GUI — URL is printed regardless
	}
}

// ── arg parsing ───────────────────────────────────────────────────────────

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--port") out.port = Number(argv[++i]);
		else if (a === "--host") out.host = argv[++i];
		else if (a === "--home") out.home = argv[++i];
		else if (a === "--reinstall") out.reinstall = true;
		else if (a === "--version" || a === "-v") out.version = true;
		else if (a === "--help" || a === "-h") out.help = true;
		else {
			console.error(`未知参数 unknown option: ${a}（--help 查看用法）`);
			process.exit(1);
		}
	}
	return out;
}

const HELP = `live2d-voice v${VERSION} — Live2D 语音伴侣，一条命令跑起来

用法 Usage:
  npx live2d-voice                 默认启动（http://127.0.0.1:43110）
  live2d-voice --port 8080         指定端口
  live2d-voice --host 0.0.0.0      监听所有网卡（局域网访问，注意安全）
  live2d-voice --home PATH         指定数据目录（默认 ~/.live2d-voice）
  live2d-voice --reinstall         强制重装依赖（升级插件时用）

环境变量 Env:
  DSH_HOME                         同 --home
  LIVE2D_VOICE_API_KEY             DeepSeek API key（推荐写在 <home>/.env）

停止 Stop: Ctrl+C`;

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.version) return console.log(VERSION);
	if (args.help) return console.log(HELP);

	const home = args.home ?? process.env.DSH_HOME ?? join(homedir(), ".live2d-voice");
	const firstRun = !existsSync(join(home, "settings.yaml"));
	const profileDir = join(home, "profiles", "web");

	console.log(`live2d-voice v${VERSION}`);
	console.log(`数据目录 home: ${home}`);

	// 1. scaffold (per-file guards: re-runs heal partial state)
	if (firstRun) console.log("首次运行：生成初始配置 first run: scaffolding…");
	mkdirSync(join(home, "models"), { recursive: true });
	mkdirSync(profileDir, { recursive: true });
	writeIfMissing(join(home, "settings.yaml"), SETTINGS_YAML);
	writeIfMissing(
		join(home, "live2d-voice.json"),
		JSON.stringify({ modelPath: join(home, "models") }, null, 2) + "\n",
	);
	writeIfMissing(join(profileDir, "package.json"), profilePackageJson());
	writeIfMissing(join(profileDir, "cordis.yml"), CORDIS_YML);
	writeIfMissing(join(home, ".env"), ENV_TEMPLATE);

	// 2. launcher token (persistent, reused across runs)
	const tokenFile = join(home, ".launcher-token");
	let token;
	if (existsSync(tokenFile)) {
		token = readFileSync(tokenFile, "utf8").trim();
	} else {
		token = randomBytes(24).toString("hex");
		writeFileSync(tokenFile, token, { mode: 0o600 });
	}

	// 3. merge <home>/.env into child env
	const fileEnv = loadEnvFile(join(home, ".env"));
	const apiKey = process.env.LIVE2D_VOICE_API_KEY ?? fileEnv.LIVE2D_VOICE_API_KEY;
	if (!apiKey) {
		console.log(`
⚠ 未检测到 LIVE2D_VOICE_API_KEY —— 聊天功能暂不可用（页面仍可打开）
  1. 到 https://platform.deepseek.com/ 创建 API key
  2. 编辑 ${join(home, ".env")}，取消注释并填入：LIVE2D_VOICE_API_KEY=sk-xxxx
  3. 重新运行 live2d-voice`);
	}

	// 4. install profile deps (full install; never rely on partial first-boot scaffold)
	const needInstall =
		args.reinstall || !existsSync(join(profileDir, "node_modules"));
	if (needInstall) {
		console.log("安装依赖（首次约 1–2 分钟）installing profile deps…");
		await run(process.execPath, [binScript("pnpm"), "install"], { cwd: profileDir });
	}

	// 5. pick port & boot
	const port = args.port ?? (await pickPort(DEFAULT_PORT));
	const host = args.host ?? "127.0.0.1";
	console.log(`启动 dsh web → http://${host}:${port} …`);

	const child = spawn(
		process.execPath,
		[binScript("@deepseek-ai/dsh"), "web", "--no-open", "--host", host, "--port", String(port)],
		{
			cwd: home,
			env: { ...process.env, ...fileEnv, DSH_HOME: home, DSH_TOKEN: token },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	// forward child logs, keep a tail for crash reports
	const tail = [];
	let ready = false;
	pipeChild(child.stdout, process.stdout, tail);
	pipeChild(child.stderr, process.stderr, tail);
	child.on("exit", (code, signal) => {
		if (!ready) {
			console.error("\ndsh 启动失败 boot failed。最近的日志 recent logs:");
			for (const line of tail.slice(-25)) console.error(`  ${line}`);
			process.exit(1);
		}
		process.exit(code ?? (signal ? 1 : 0));
	});
	for (const sig of ["SIGINT", "SIGTERM"]) {
		process.on(sig, () => {
			if (!child.killed) child.kill(sig);
		});
	}

	// 6. wait until the plugin's config endpoint answers
	const probeUrl = `http://127.0.0.1:${port}/live2d-voice/config?token=${token}`;
	const deadline = Date.now() + 120_000;
	while (!(await probe(probeUrl))) {
		if (child.exitCode !== null) return; // exit handler prints the crash report
		if (Date.now() > deadline) {
			console.error("等待启动超时 timeout（120s）。最近的日志 recent logs:");
			for (const line of tail.slice(-25)) console.error(`  ${line}`);
			child.kill("SIGTERM");
			process.exit(1);
		}
		await sleep(500);
	}
	ready = true;

	// 7. open the session picker
	const page = `http://localhost:${port}/live2d-voice?token=${token}`;
	openBrowser(page);
	console.log(`
✅ 就绪 ready！
   打开 open: ${page}
   数据目录 home: ${home}（模型放 ${join(home, "models")}）
   停止 stop: Ctrl+C`);
	if (!apiKey) console.log("   ⚠ API key 未配置，聊天前请先设置（见上方指引）");
}

function writeIfMissing(file, content) {
	if (!existsSync(file)) writeFileSync(file, content);
}

function pipeChild(stream, sink, tail) {
	let buf = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => {
		buf += chunk;
		let idx;
		while ((idx = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, idx);
			buf = buf.slice(idx + 1);
			if (line.trim()) {
				tail.push(line);
				if (tail.length > 60) tail.shift();
			}
			sink.write(`  ${line}\n`);
		}
	});
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
	console.error(`✗ ${err.message}`);
	process.exit(1);
});
