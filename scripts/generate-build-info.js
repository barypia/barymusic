const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'server', 'package.json'), 'utf8'));
const useBuildMetadataFromEnv = process.argv[2] === '--from-env';
const outputArgument = process.argv[useBuildMetadataFromEnv ? 3 : 2];
const outputPath = outputArgument
	? path.resolve(outputArgument)
	: path.join(repoRoot, 'server', 'build-info.json');

let commit = null;
let dirty = null;

const commitOverride = process.env.BARYMUSIC_BUILD_COMMIT;
const dirtyOverride = process.env.BARYMUSIC_BUILD_DIRTY;
if (useBuildMetadataFromEnv) {
	if (typeof commitOverride === 'string' && /^[0-9a-f]{40,64}$/i.test(commitOverride.trim())) {
		commit = commitOverride.trim();
	}
	if (dirtyOverride === 'true') dirty = true;
	if (dirtyOverride === 'false') dirty = false;
} else {
	try {
		commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		if (!/^[0-9a-f]{40,64}$/i.test(commit)) commit = null;
		else {
			const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
				cwd: repoRoot,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			});
			dirty = status.length > 0;
		}
	} catch {
		commit = null;
		dirty = null;
	}
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ version: packageJson.version, commit, dirty }, null, 2)}\n`);
console.log(`Generated build info: ${outputPath}`);