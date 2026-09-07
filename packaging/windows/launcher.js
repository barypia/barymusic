const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const readline = require('readline/promises');

const releaseRoot = path.resolve(__dirname, '..');
const runtimeNode = path.join(releaseRoot, 'runtime', 'node.exe');
const serverEntry = path.join(__dirname, 'server', 'barymusic.js');
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const userRoot = path.join(localAppData, 'BaryMusic');
const dataDir = path.join(userRoot, 'data');
const configDir = path.join(userRoot, 'config');
const logsDir = path.join(userRoot, 'logs');
const launcherConfigPath = path.join(configDir, 'launcher.json');
const serverEnvPath = path.join(configDir, '.env');
const logPath = path.join(logsDir, 'barymusic.log');

function systemLanguage() {
	const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
	return locale.startsWith('pl') ? 'pl' : 'en';
}

const messages = {
	pl: {
		nonInteractive: 'Brak interaktywnego terminala. Uzywam bezpiecznych ustawien domyslnych.',
		availabilityQuestion: 'Gdzie BaryMusic ma być dostępne?',
		localMode: 'Tylko na tym komputerze (localhost) - zalecane',
		lanMode: 'W sieci lokalnej (LAN) - inne urządzenia w Twojej sieci lokalnej będą mogły się połączyć',
		modePrompt: value => `Wybierz tryb [${value}]: `,
		validMode: 'Wpisz numer 1 lub 2: ',
		portDescription: 'To numer lokalnego adresu aplikacji. Zostaw 3000, jeśli nie masz konkretnego powodu, aby go zmieniać',
		portPrompt: value => `Port BaryMusic[${value}]: `,
		invalidPort: 'Port musi byc liczba od 1 do 65535.',
		browserPrompt: value => `Otworzyć przeglądarkę automatycznie? [${value}]: `,
		serverExited: code => `Serwer zakonczyl dzialanie z kodem ${code}.`,
		serverTimeout: 'Serwer nie odpowiedzial w ciagu 20 sekund.',
		missingRuntime: value => `Nie znaleziono runtime Node.js: ${value}`,
		missingServer: value => `Nie znaleziono serwera BaryMusic: ${value}`,
		portUnavailable: value => `Nie udało się uruchomić BaryMusic — port ${value} jest już zajęty.`,
		chooseDifferentPort: 'Wybierz inny port dla aplikacji.',
		newPortPrompt: value => `Nowy port [${value}]: `,
		stopping: 'Zatrzymywanie BaryMusic...',
		running: 'BaryMusic jest uruchomiony.',
		thisComputer: value => `Na tym komputerze: ${value}`,
		otherDevices: 'Na innych urzadzeniach w sieci lokalnej:',
		noLanAddress: 'Nie znaleziono aktywnego adresu IPv4 dla sieci lokalnej.',
		stopHint: 'Aby zakonczyc, nacisnij Ctrl+C lub zamknij to okno.',
		log: value => `Log: ${value}`,
		saved: value => `Zapisano ustawienia w: ${value}`,
		startFailed: value => `Nie udalo sie uruchomic BaryMusic: ${value}`,
		details: value => `Szczegoly: ${value}`,
	},
	en: {
		nonInteractive: 'No interactive terminal detected. Using safe default settings.',
		availabilityQuestion: 'Where should BaryMusic be available?',
		localMode: 'Only on this computer (localhost) - recommended',
		lanMode: 'On the local network (LAN) - other devices on your local network will be able to connect',
		modePrompt: value => `Choose a mode [${value}]: `,
		validMode: 'Enter 1 or 2: ',
		portDescription: "This is the number in the application's local address. Leave it at 3000 unless you have a specific reason to change it.",
		portPrompt: value => `BaryMusic port [${value}]: `,
		invalidPort: 'The port must be a number from 1 to 65535.',
		browserPrompt: value => `Open the browser automatically? [${value}]: `,
		serverExited: code => `The server exited with code ${code}.`,
		serverTimeout: 'The server did not respond within 20 seconds.',
		missingRuntime: value => `Node.js runtime not found: ${value}`,
		missingServer: value => `BaryMusic server not found: ${value}`,
		portUnavailable: value => `BaryMusic could not be started — port ${value} is already in use.`,
		chooseDifferentPort: 'Choose a different port for the application.',
		newPortPrompt: value => `New port [${value}]: `,
		stopping: 'Stopping BaryMusic...',
		running: 'BaryMusic is running.',
		thisComputer: value => `On this computer: ${value}`,
		otherDevices: 'On other devices in the local network:',
		noLanAddress: 'No active local-network IPv4 address was found.',
		stopHint: 'Press Ctrl+C or close this window to stop.',
		log: value => `Log: ${value}`,
		saved: value => `Settings saved to: ${value}`,
		startFailed: value => `BaryMusic could not be started: ${value}`,
		details: value => `Details: ${value}`,
	},
};

function message(language, key, value) {
	const entry = messages[language]?.[key] ?? messages.en[key];
	return typeof entry === 'function' ? entry(value) : entry;
}

const defaultSettings = Object.freeze({
	language: systemLanguage(),
	networkMode: 'local',
	port: 3000,
	openBrowser: true,
});

function normalizeSettings(value) {
	if (!value || typeof value !== 'object') return null;
	const port = Number(value.port);
	if (!['local', 'lan'].includes(value.networkMode)) return null;
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
	return {
		language: ['pl', 'en'].includes(value.language) ? value.language : null,
		networkMode: value.networkMode,
		port,
		openBrowser: value.openBrowser !== false,
	};
}

function loadSettings() {
	try {
		return normalizeSettings(JSON.parse(fs.readFileSync(launcherConfigPath, 'utf8')));
	} catch {
		return null;
	}
}

function saveSettings(settings) {
	fs.mkdirSync(configDir, { recursive: true });
	fs.writeFileSync(launcherConfigPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function ensureUserDirectories() {
	for (const directory of [dataDir, path.join(dataDir, 'audio'), path.join(dataDir, 'notes'), configDir, logsDir]) {
		fs.mkdirSync(directory, { recursive: true });
	}
	if (!fs.existsSync(serverEnvPath)) {
		fs.writeFileSync(serverEnvPath, [
			'# BaryMusic server settings',
			'ADMINS=',
			'CAN_ADD_SONGS=',
			'ALLOW_ALL_USERS_TO_ADD_SONGS=true',
			'ALLOW_REGISTRATION=true',
			'',
		].join('\n'), 'utf8');
	}
}

async function askForSettings(current = defaultSettings) {
	if (!process.stdin.isTTY) {
		const language = current.language || systemLanguage();
		console.log(message(language, 'nonInteractive'));
		return { ...current, language };
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		console.log('\nWybierz język / Choose a language\n');
		console.log('1. Polski');
		console.log('2. English');
		const defaultLanguage = '1';
		let languageAnswer = (await rl.question(`\nWpisz numer / Enter a number [${defaultLanguage}]: `)).trim() || defaultLanguage;
		while (!['1', '2'].includes(languageAnswer)) {
			languageAnswer = (await rl.question('Wpisz numer / Enter a number [1]: ')).trim() || '1';
		}
		const language = languageAnswer === '2' ? 'en' : 'pl';

		console.log(`\n${message(language, 'availabilityQuestion')}\n`);
		console.log(`1. ${message(language, 'localMode')}`);
		console.log(`2. ${message(language, 'lanMode')}`);
		const defaultMode = current.networkMode === 'lan' ? '2' : '1';
		let modeAnswer = (await rl.question(`\n${message(language, 'modePrompt', defaultMode)}`)).trim() || defaultMode;
		while (!['1', '2'].includes(modeAnswer)) {
			modeAnswer = (await rl.question(message(language, 'validMode'))).trim();
		}

		let port = current.port;
		console.log(`\n${message(language, 'portDescription')}`);
		while (true) {
			const portAnswer = (await rl.question(message(language, 'portPrompt', port))).trim();
			if (!portAnswer) break;
			const candidate = Number(portAnswer);
			if (Number.isInteger(candidate) && candidate >= 1 && candidate <= 65535) {
				port = candidate;
				break;
			}
			console.log(message(language, 'invalidPort'));
		}

		const browserDefault = language === 'pl'
			? current.openBrowser ? 'T/n' : 't/N'
			: current.openBrowser ? 'Y/n' : 'y/N';
		const browserAnswer = (await rl.question(`\n${message(language, 'browserPrompt', browserDefault)}`))
			.trim().toLowerCase();
		const openBrowser = browserAnswer
			? ['t', 'tak', 'y', 'yes'].includes(browserAnswer)
			: current.openBrowser;

		const settings = {
			language,
			networkMode: modeAnswer === '2' ? 'lan' : 'local',
			port,
			openBrowser,
		};
		return settings;
	} finally {
		rl.close();
	}
}

function lanAddresses() {
	const addresses = new Set();
	for (const interfaces of Object.values(os.networkInterfaces())) {
		for (const entry of interfaces || []) {
			if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
			addresses.add(entry.address);
		}
	}
	return [...addresses];
}

function openBrowser(url) {
	const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], {
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
	});
	browser.unref();
}

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function requireAvailablePort(host, port, language) {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.unref();
		probe.once('error', error => {
			if (error.code !== 'EADDRINUSE') {
				reject(error);
				return;
			}
			const portError = new Error(message(language, 'portUnavailable', port));
			portError.code = 'EADDRINUSE';
			portError.port = port;
			reject(portError);
		});
		probe.listen({ host, port, exclusive: true }, () => probe.close(resolve));
	});
}

function nextSuggestedPort(port) {
	return port < 65535 ? port + 1 : 3000;
}

async function askForNewPort(settings, occupiedPort) {
	const language = settings.language;
	const host = settings.networkMode === 'lan' ? '0.0.0.0' : '127.0.0.1';
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	let unavailablePort = occupiedPort;
	let suggestedPort = nextSuggestedPort(occupiedPort);

	try {
		while (true) {
			console.log(`\n${message(language, 'portUnavailable', unavailablePort)}`);
			console.log(message(language, 'chooseDifferentPort'));
			const answer = (await rl.question(message(language, 'newPortPrompt', suggestedPort))).trim();
			const candidate = answer ? Number(answer) : suggestedPort;

			if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) {
				console.log(message(language, 'invalidPort'));
				continue;
			}

			try {
				await requireAvailablePort(host, candidate, language);
				const updatedSettings = { ...settings, port: candidate };
				saveSettings(updatedSettings);
				return updatedSettings;
			} catch (error) {
				if (error.code !== 'EADDRINUSE') throw error;
				unavailablePort = candidate;
				suggestedPort = nextSuggestedPort(candidate);
			}
		}
	} finally {
		rl.close();
	}
}

async function waitUntilReady(url, child, language, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(message(language, 'serverExited', child.exitCode));
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
			if (response.ok) return;
		} catch {}
		await delay(250);
	}
	throw new Error(message(language, 'serverTimeout'));
}

async function startServer(settings) {
	const { language } = settings;
	if (!fs.existsSync(runtimeNode)) throw new Error(message(language, 'missingRuntime', runtimeNode));
	if (!fs.existsSync(serverEntry)) throw new Error(message(language, 'missingServer', serverEntry));

	ensureUserDirectories();
	const host = settings.networkMode === 'lan' ? '0.0.0.0' : '127.0.0.1';
	await requireAvailablePort(host, settings.port, language);
	const languageQuery = `?lng=${encodeURIComponent(language)}`;
	const localUrl = `http://localhost:${settings.port}/${languageQuery}`;
	const healthUrl = `http://127.0.0.1:${settings.port}/`;
	const logStream = fs.createWriteStream(logPath, { flags: 'a' });
	logStream.write(`\n[${new Date().toISOString()}] Starting BaryMusic (${settings.networkMode}, ${host}:${settings.port})\n`);

	const child = spawn(runtimeNode, [serverEntry], {
		cwd: path.dirname(serverEntry),
		env: {
			...process.env,
			NODE_ENV: 'production',
			HOST: host,
			PORT: String(settings.port),
			BARYMUSIC_HOME: userRoot,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: false,
	});

	child.stdout.on('data', chunk => {
		process.stdout.write(chunk);
		logStream.write(chunk);
	});
	child.stderr.on('data', chunk => {
		process.stderr.write(chunk);
		logStream.write(chunk);
	});

	let stopping = false;
	const stop = () => {
		if (stopping || child.exitCode !== null) return;
		stopping = true;
		console.log(`\n${message(language, 'stopping')}`);
		child.kill('SIGTERM');
	};
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);

	try {
		await waitUntilReady(healthUrl, child, language);
		console.log(`\n${message(language, 'running')}`);
		console.log(message(language, 'thisComputer', localUrl));
		if (settings.networkMode === 'lan') {
			const addresses = lanAddresses();
			if (addresses.length) {
				console.log(`\n${message(language, 'otherDevices')}`);
				for (const address of addresses) console.log(`  http://${address}:${settings.port}/${languageQuery}`);
			} else {
				console.log(`\n${message(language, 'noLanAddress')}`);
			}
		}
		console.log(`\n${message(language, 'stopHint')}`);
		console.log(`${message(language, 'log', logPath)}\n`);
		if (settings.openBrowser) openBrowser(localUrl);

		const exitCode = child.exitCode !== null
			? child.exitCode
			: await new Promise(resolve => child.once('exit', code => resolve(code ?? 0)));
		return stopping ? 0 : exitCode;
	} catch (error) {
		if (child.exitCode === null) child.kill('SIGTERM');
		throw error;
	} finally {
		logStream.end();
	}
}

async function main() {
	ensureUserDirectories();
	let settings = loadSettings();
	const configureOnly = process.argv.includes('--configure');
	const useDefaults = process.argv.includes('--defaults');
	if (!settings || !settings.language || configureOnly) {
		settings = useDefaults
			? { ...(settings || defaultSettings), language: settings?.language || systemLanguage() }
			: await askForSettings(settings || defaultSettings);
		saveSettings(settings);
		console.log(`\n${message(settings.language, 'saved', launcherConfigPath)}`);
	}
	if (configureOnly) return 0;
	const disableBrowser = process.env.BARYMUSIC_NO_BROWSER === '1' || process.argv.includes('--no-browser');
	while (true) {
		const runtimeSettings = disableBrowser ? { ...settings, openBrowser: false } : settings;
		try {
			return await startServer(runtimeSettings);
		} catch (error) {
			if (error.code !== 'EADDRINUSE' || !process.stdin.isTTY) throw error;
			settings = await askForNewPort(settings, error.port ?? settings.port);
		}
	}
}

main()
	.then(code => {
		process.exitCode = code;
	})
	.catch(error => {
		const language = loadSettings()?.language || systemLanguage();
		console.error(`\n${message(language, 'startFailed', error.message)}`);
		console.error(message(language, 'details', logPath));
		process.exitCode = 1;
	});
