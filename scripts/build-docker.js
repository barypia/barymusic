const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const generatorPath = path.join(__dirname, 'generate-build-info.js');
const buildInfoPath = path.join(repoRoot, 'server', 'build-info.json');

function run(command, args) {
	const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
	if (result.error) throw result.error;
	return result.status === null ? 1 : result.status;
}

try {
	const generatorStatus = run(process.execPath, [generatorPath]);
	if (generatorStatus !== 0) {
		process.exitCode = generatorStatus;
	} else {
		const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
		const dockerOptions = process.argv.slice(2);
		if (dockerOptions.length === 0) dockerOptions.push('.');
		const context = dockerOptions.pop();
		const dockerArgs = [
			'build',
			...dockerOptions,
			'--build-arg', `BARYMUSIC_BUILD_COMMIT=${buildInfo.commit || ''}`,
			'--build-arg', `BARYMUSIC_BUILD_DIRTY=${typeof buildInfo.dirty === 'boolean' ? buildInfo.dirty : ''}`,
			context,
		];
		process.exitCode = run('docker', dockerArgs);
	}
} catch (error) {
	console.error(`Docker build failed: ${error.message}`);
	process.exitCode = 1;
}