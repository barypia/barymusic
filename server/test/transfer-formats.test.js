const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { ZipArchive } = require('archiver');
const sharp = require('sharp');
const unzipper = require('unzipper');
const sqlite3 = require('sqlite3').verbose();
const serverDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-server-data-'));
process.env.BARYMUSIC_HOME = serverDataDir;
const {
  accessibleRowsById,
  closeDatabase,
  convertUploadedSheet,
  importLibrary,
  normalizeSong,
  openBaryMusic,
  parseExternalZip,
  parseUploadedFiles,
  remapItems,
  restoreBackup,
  setMutableMediaCacheHeaders,
  songFromChordPro,
  songFromOpenLyrics,
  songToChordPro,
  songToOpenLyrics,
  streamTextExport,
  validateBackupManifest,
} = require('../barymusic');

test('mutable media responses are always revalidated by private caches', () => {
  const headers = new Map();
  setMutableMediaCacheHeaders({ setHeader: (name, value) => headers.set(name, value) });

  assert.equal(headers.get('Cache-Control'), 'private, no-cache, must-revalidate');
  assert.equal(headers.get('Pragma'), 'no-cache');
  assert.equal(headers.get('Expires'), '0');
});

test('uploaded sheet images are converted to bounded WebP output', async () => {
  const source = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#336699' },
  }).png().toBuffer();
  const output = await convertUploadedSheet(source);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
});

test('uploaded sheet conversion rejects invalid image data', async () => {
  await assert.rejects(convertUploadedSheet(Buffer.from('not-an-image')));
});

test('uploaded sheet conversion rejects images above the pixel limit', async () => {
  const oversizedSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="6000"><rect width="1" height="1"/></svg>');
  await assert.rejects(convertUploadedSheet(oversizedSvg), /pixel limit/i);
});

test.after(async () => {
  await closeDatabase();
  fs.rmSync(serverDataDir, { recursive: true, force: true });
});

const lyrics = {
  version: 2,
  sections: {
    v1: { type: 'verse', lines: ['[C]First line', 'Second [G/B]line'] },
    c1: { type: 'chorus', lines: ['[Am]Chorus'] },
  },
  order: [
    { id: 'v1', timestamp: 5, repeat: 2, sheetAnchor: { x: 10, y: 20 } },
    { id: 'c1' }, { id: 'c1', timestamp: 30 },
  ],
};

const song = {
  id: 7, title: 'Example', tags: ['worship', 'test'], bpm: 120, key: 'C',
  timeSignature: '4/4', composer: 'Composer', year: 2025, lyrics, isPublic: false,
};

test('canonical BaryMusic song preserves all lyrics v2 fields', () => {
  const normalized = normalizeSong(song);
  assert.deepEqual(normalized.lyrics, lyrics);
  assert.equal(normalized.isPublic, false);
  assert.deepEqual(normalized.tags, ['worship', 'test']);
});

test('OpenLyrics round-trip preserves supported metadata, order, sections, and chords', () => {
  const xml = songToOpenLyrics(song);
  assert.match(xml, /version="0\.8"/);
  assert.match(xml, /<chord name="C"\/>First line/);
  assert.doesNotMatch(xml, /<chord root=/);
  const imported = songFromOpenLyrics(xml);
  assert.equal(imported.song.title, song.title);
  assert.equal(imported.song.composer, song.composer);
  assert.equal(imported.song.bpm, song.bpm);
  assert.equal(imported.song.lyrics.sections.v1.lines[0], '[C]First line');
  assert.deepEqual(imported.song.lyrics.order.map(entry => entry.id), ['v1', 'v1', 'c1', 'c1']);
  assert.ok(imported.warnings.length);
});

test('OpenLyrics uses chord spelling recognized by OpenLP', () => {
  const xml = songToOpenLyrics({
    title: 'OpenLP chords',
    lyrics: {
      version: 2,
      sections: { v1: { type: 'verse', lines: ['[dm]One [B♭]two [e♭]three [f♯/a♭]four'] } },
      order: [{ id: 'v1' }],
    },
  });
  assert.match(xml, /<chord name="Dm"\/>One/);
  assert.match(xml, /<chord name="Bb"\/>two/);
  assert.match(xml, /<chord name="Eb"\/>three/);
  assert.match(xml, /<chord name="F#\/Ab"\/>four/);
});

test('OpenLyrics rejects DTD declarations', () => {
  assert.throws(() => songFromOpenLyrics('<!DOCTYPE song [<!ENTITY x "test">]><song/>'), /DTD/);
});

test('OpenLyrics exports repeated chorus references as c1 in verseOrder', () => {
  const xml = songToOpenLyrics({
    title: 'Repeated chorus',
    lyrics: {
      version: 2,
      sections: {
        v1: { type: 'verse', lines: ['Verse one'] },
        v2: { type: 'verse', lines: ['Verse two'] },
        c1: { type: 'chorus', lines: ['Chorus'] },
      },
      order: [{ id: 'v1' }, { id: 'c1', repeat: 2 }, { id: 'v2' }, { id: 'c1' }],
    },
  });
  assert.match(xml, /<verseOrder>v1 c1 c1 v2 c1<\/verseOrder>/);
  assert.equal((xml.match(/<verse name="c1">/g) || []).length, 1);
});

test('ChordPro round-trip preserves supported metadata, sections, and inline chords', () => {
  const chordPro = songToChordPro(song, { sheetFile: 'Example-sheet.png' });
  const imported = songFromChordPro(chordPro);
  assert.match(chordPro, /\{image: "Example-sheet\.png"\}/);
  assert.deepEqual(imported.images, ['Example-sheet.png']);
  assert.equal(imported.song.title, song.title);
  assert.equal(imported.song.key, 'C');
  assert.equal(imported.song.lyrics.sections.v1.lines[0], '[C]First line');
  assert.equal(imported.song.lyrics.sections.c1.type, 'chorus');
  assert.ok(imported.warnings.length);
});

test('ChordPro ZIP imports a referenced sheet image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-chordpro-'));
  const file = path.join(dir, 'songs.zip');
  const audioDir = path.join(dir, 'audio');
  const notesDir = path.join(dir, 'notes');
  fs.mkdirSync(audioDir); fs.mkdirSync(notesDir);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(file);
    const archive = new ZipArchive();
    output.on('close', resolve); archive.on('error', reject); archive.pipe(output);
    archive.append(songToChordPro(song, { sheetFile: 'Example-sheet.png' }), { name: 'Example.cho' });
    archive.append(png, { name: 'Example-sheet.png' });
    archive.finalize();
  });
  const parsed = await parseExternalZip(file);
  assert.deepEqual(parsed.formats, ['ChordPro ZIP']);
  assert.equal(parsed.songs[0].media.sheets, 'Example-sheet.png');

  const db = new sqlite3.Database(':memory:');
  const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  const get = sql => new Promise((resolve, reject) => db.get(sql, (error, row) => error ? reject(error) : resolve(row)));
  const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  await exec(`
    CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT, bpm INTEGER, key TEXT, timeSignature TEXT, composer TEXT, year INTEGER, lyrics TEXT, filesAudio INTEGER DEFAULT 0, filesSheets TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
    CREATE TABLE setlists (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, items TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
  `);
  try {
    await importLibrary(db, { songs: parsed.songs, setlists: [] }, 1, file, audioDir, notesDir);
    assert.equal((await get('SELECT filesSheets FROM songs')).filesSheets, '.webp');
    assert.ok(fs.statSync(path.join(notesDir, '1.webp')).size > 0);
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple ChordPro ZIP archives keep their own sheet files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-multi-zip-'));
  const audioDir = path.join(dir, 'audio');
  const notesDir = path.join(dir, 'notes');
  fs.mkdirSync(audioDir); fs.mkdirSync(notesDir);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const files = [];

  for (const [index, title] of ['First', 'Second'].entries()) {
    const file = path.join(dir, `${title}.zip`);
    const sheetFile = `${title}-sheet.png`;
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(file);
      const archive = new ZipArchive();
      output.on('close', resolve); archive.on('error', reject); archive.pipe(output);
      archive.append(songToChordPro({ ...song, title }, { sheetFile }), { name: `${title}.cho` });
      archive.append(png, { name: sheetFile });
      archive.finalize();
    });
    files.push({ originalname: `${title}.zip`, path: file });
  }

  const parsed = await parseUploadedFiles(files);
  assert.deepEqual(parsed.formats, ['ChordPro ZIP']);
  assert.deepEqual(parsed.archivePaths, files.map(file => file.path));
  assert.deepEqual(parsed.sources.map(source => [source.filename, source.formats]), [
    ['First.zip', ['ChordPro ZIP']],
    ['Second.zip', ['ChordPro ZIP']],
  ]);
  assert.deepEqual(parsed.payload.songs.map(item => item.archiveId), ['0:0', '1:0']);
  assert.deepEqual(parsed.payload.songs.map(item => item.media.archiveIndex), [0, 1]);

  const db = new sqlite3.Database(':memory:');
  const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
  const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  await exec(`
    CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT, bpm INTEGER, key TEXT, timeSignature TEXT, composer TEXT, year INTEGER, lyrics TEXT, filesAudio INTEGER DEFAULT 0, filesSheets TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
    CREATE TABLE setlists (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, items TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
  `);
  try {
    await importLibrary(db, parsed.payload, 1, parsed.archivePaths, audioDir, notesDir);
    assert.deepEqual((await all('SELECT title, filesSheets FROM songs ORDER BY id')).map(row => [row.title, row.filesSheets]), [
      ['First', '.webp'],
      ['Second', '.webp'],
    ]);
    assert.ok(fs.existsSync(path.join(notesDir, '1.webp')));
    assert.ok(fs.existsSync(path.join(notesDir, '2.webp')));
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ChordPro export bundles a portable PNG next to the song', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-chordpro-export-'));
  const notesDir = path.join(dir, 'notes');
  fs.mkdirSync(notesDir);
  fs.writeFileSync(path.join(notesDir, '7.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><path d="M0 8h32" stroke="black"/></svg>');
  const row = {
    id: 7,
    title: song.title,
    type: JSON.stringify(song.tags),
    bpm: song.bpm,
    key: song.key,
    timeSignature: song.timeSignature,
    composer: song.composer,
    year: song.year,
    lyrics: JSON.stringify(song.lyrics),
    isPublic: 1,
    filesSheets: '.svg',
  };
  const response = new PassThrough();
  response.type = () => response;
  response.attachment = name => { response.filename = name; return response; };
  const chunks = [];
  response.on('data', chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    response.on('finish', resolve);
    response.on('error', reject);
  });
  try {
    await streamTextExport(response, 'chordpro', [row], notesDir);
    await finished;
    assert.match(response.filename, /\.zip$/);
    const archive = await unzipper.Open.buffer(Buffer.concat(chunks));
    const files = new Map(archive.files.filter(entry => entry.type === 'File').map(entry => [entry.path, entry]));
    assert.ok(files.has('Example.cho'));
    assert.ok(files.has('Example-sheet.png'));
    assert.match((await files.get('Example.cho').buffer()).toString('utf8'), /\{image: "Example-sheet\.png"\}/);
    const sheet = await files.get('Example-sheet.png').buffer();
    assert.deepEqual(sheet.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal((await sharp(sheet).metadata()).density, 192);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('setlist song references are remapped recursively', () => {
  const items = [{ type: 'group', title: 'A', items: [{ type: 'song', songRef: 'old-7' }] }];
  assert.deepEqual(remapItems(items, new Map([['old-7', 44]])), [{ type: 'group', title: 'A', items: [{ type: 'song', songId: 44 }] }]);
});

test('large export selections are queried in safe batches', async () => {
  const db = new sqlite3.Database(':memory:');
  const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  await exec(`CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT, isPublic INTEGER, uploadedBy INTEGER);`);
  await exec(`INSERT INTO songs (id, title, isPublic, uploadedBy) VALUES ${Array.from({ length: 1200 }, (_, index) => `(${index + 1}, 'Song ${index + 1}', 1, 1)`).join(',')}`);
  try {
    const rows = await accessibleRowsById(db, 'songs', Array.from({ length: 1200 }, (_, index) => index + 1), 1);
    assert.equal(rows.length, 1200);
  } finally {
    await close();
  }
});

test('server backup requires an administrator and valid owners', () => {
  const manifest = { kind: 'server-backup', payload: { users: [{ id: 1, username: 'admin', passwordHash: '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789', isAdmin: 1 }], songs: [{ ...song, id: 1, archiveId: '1', uploadedBy: 1 }], setlists: [], userSettings: [] } };
  assert.equal(validateBackupManifest(manifest).users.length, 1);
  assert.throws(() => validateBackupManifest({ ...manifest, payload: { ...manifest.payload, users: [{ ...manifest.payload.users[0], isAdmin: 0 }] } }), /administrator/);
  assert.throws(() => validateBackupManifest({ ...manifest, payload: { ...manifest.payload, songs: [{ ...manifest.payload.songs[0], uploadedBy: 2 }] } }), /owner/);
  assert.throws(() => validateBackupManifest({ ...manifest, payload: { ...manifest.payload, userSettings: [{ id: 1, userId: 2, settings: {} }] } }), /user settings/);

  let items = [{ type: 'song', songId: 1 }];
  for (let depth = 0; depth < 22; depth++) items = [{ type: 'group', title: 'Group', items }];
  assert.throws(() => validateBackupManifest({ ...manifest, payload: { ...manifest.payload, setlists: [{ id: 1, title: 'Set', uploadedBy: 1, items }] } }), /nesting/);
});

async function createArchive(filePath, manifest, media) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = new ZipArchive();
    output.on('close', resolve); archive.on('error', reject); archive.pipe(output);
    archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
    if (media) archive.append(media.buffer, { name: media.path });
    archive.finalize();
  });
}

test('BaryMusic archive validates media checksum', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-test-'));
  const file = path.join(dir, 'test.barymusic');
  const buffer = Buffer.from('media bytes');
  const mediaPath = 'media/audio/1.mp3';
  const manifest = {
    format: 'BaryMusic', schemaVersion: 2, kind: 'library', payload: { songs: [{ ...song, archiveId: '1', media: { audio: mediaPath } }], setlists: [] },
    files: [{ path: mediaPath, size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') }],
  };
  try {
    await createArchive(file, manifest, { path: mediaPath, buffer });
    const opened = await openBaryMusic(file);
    assert.equal(opened.manifest.kind, 'library');
    manifest.files[0].sha256 = '0'.repeat(64);
    await createArchive(file, manifest, { path: mediaPath, buffer });
    await assert.rejects(openBaryMusic(file), /checksum/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('BaryMusic archive rejects duplicate and undeclared entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-invalid-archive-'));
  const duplicate = path.join(dir, 'duplicate.barymusic');
  const undeclared = path.join(dir, 'undeclared.barymusic');
  const songWithMedia = { ...song, archiveId: '1', media: { audio: 'media/audio/1.mp3' } };
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(duplicate);
      const archive = new ZipArchive();
      output.on('close', resolve); archive.on('error', reject); archive.pipe(output);
      archive.append('{}', { name: 'manifest.json' });
      archive.append('{}', { name: 'manifest.json' });
      archive.finalize();
    });
    await assert.rejects(openBaryMusic(duplicate), /duplicate path/);

    await createArchive(undeclared, {
      format: 'BaryMusic', schemaVersion: 2, kind: 'library', files: [],
      payload: { songs: [songWithMedia], setlists: [] },
    }, { path: 'media/audio/1.mp3', buffer: Buffer.from('audio') });
    await assert.rejects(openBaryMusic(undeclared), /Undeclared/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple BaryMusic archives namespace colliding song and setlist references', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-multi-library-'));
  const files = [];
  try {
    for (const [index, title] of ['First', 'Second'].entries()) {
      const file = path.join(dir, `${title}.barymusic`);
      const manifest = {
        format: 'BaryMusic', schemaVersion: 2, kind: 'library', files: [],
        payload: {
          songs: [{ ...song, archiveId: '1', title }],
          setlists: [{ archiveId: '1', title: `Set ${index + 1}`, items: [{ type: 'song', songRef: '1' }] }],
        },
      };
      await createArchive(file, manifest);
      files.push({ originalname: `${title}.barymusic`, path: file });
    }

    const parsed = await parseUploadedFiles(files);
    assert.deepEqual(parsed.payload.songs.map(item => item.archiveId), ['0:1', '1:1']);
    assert.deepEqual(parsed.payload.songs.map(item => [item.sourceIndex, item.fromSetlist]), [[0, true], [1, true]]);
    assert.deepEqual(parsed.payload.setlists.map(item => item.items[0].songRef), ['0:1', '1:1']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('library import always creates new IDs and remaps setlists', async () => {
  const db = new sqlite3.Database(':memory:');
  const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
  const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-import-'));
  const audioDir = path.join(mediaDir, 'audio');
  const notesDir = path.join(mediaDir, 'notes');
  fs.mkdirSync(audioDir); fs.mkdirSync(notesDir);
  await exec(`
    CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT, bpm INTEGER, key TEXT, timeSignature TEXT, composer TEXT, year INTEGER, lyrics TEXT, filesAudio INTEGER DEFAULT 0, filesSheets TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
    CREATE TABLE setlists (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, items TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
  `);
  const media = Buffer.from('round-trip audio');
  const mediaPath = 'media/audio/source-song.mp3';
  const archivePath = path.join(mediaDir, 'library.barymusic');
  const transferSong = { ...song, archiveId: 'source-song', media: { audio: mediaPath } };
  const archiveManifest = {
    format: 'BaryMusic', schemaVersion: 2, kind: 'library',
    payload: { songs: [transferSong], setlists: [] },
    files: [{ path: mediaPath, size: media.length, sha256: crypto.createHash('sha256').update(media).digest('hex') }],
  };
  await createArchive(archivePath, archiveManifest, { path: mediaPath, buffer: media });
  const payload = {
    songs: [transferSong],
    setlists: [{ title: 'Set', items: [{ type: 'group', title: 'Part', items: [{ type: 'song', songRef: 'source-song' }] }] }],
  };
  try {
    await importLibrary(db, payload, 1, archivePath, audioDir, notesDir);
    await importLibrary(db, payload, 1, archivePath, audioDir, notesDir);
    const songs = await all('SELECT id FROM songs ORDER BY id');
    const setlists = await all('SELECT items FROM setlists ORDER BY id');
    assert.deepEqual(songs.map(row => row.id), [1, 2]);
    assert.equal(JSON.parse(setlists[0].items)[0].items[0].songId, 1);
    assert.equal(JSON.parse(setlists[1].items)[0].items[0].songId, 2);
    assert.deepEqual(fs.readFileSync(path.join(audioDir, '1.mp3')), media);
    assert.deepEqual(fs.readFileSync(path.join(audioDir, '2.mp3')), media);
  } finally {
    await close();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
});

test('server backup restore preserves IDs and persistent state but clears sessions', async () => {
  const db = new sqlite3.Database(':memory:');
  const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
  const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  await exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, passwordHash TEXT, canAddSongs INTEGER, isAdmin INTEGER, createdAt INTEGER);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, userId INTEGER, expiresAt INTEGER, createdAt INTEGER);
    CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT, type TEXT, bpm INTEGER, key TEXT, timeSignature TEXT, composer TEXT, year INTEGER, lyrics TEXT, filesAudio INTEGER, filesSheets TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
    CREATE TABLE setlists (id INTEGER PRIMARY KEY, title TEXT, description TEXT, items TEXT, uploadedBy INTEGER, isPublic INTEGER, createdAt INTEGER);
    CREATE TABLE user_settings (id INTEGER PRIMARY KEY, userId INTEGER, channelId INTEGER, settings TEXT, createdAt INTEGER, updatedAt INTEGER);
  `);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'barymusic-restore-'));
  const audioDir = path.join(dir, 'audio'); const notesDir = path.join(dir, 'notes');
  fs.mkdirSync(audioDir); fs.mkdirSync(notesDir);
  const file = path.join(dir, 'backup.barymusic');
  const backupSong = { ...normalizeSong(song), id: 12, archiveId: '12', uploadedBy: 5 };
  const manifest = {
    format: 'BaryMusic', schemaVersion: 2, kind: 'server-backup', files: [],
    payload: {
      config: { admins: ['admin'], canAddSongs: ['admin'], allowAllUsersToAddSongs: false, allowRegistration: true, corsOrigin: 'http://localhost:3000', port: 3000 },
      users: [{ id: 5, username: 'admin', passwordHash: '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789', canAddSongs: 1, isAdmin: 1, createdAt: 1 }],
      userSettings: [{ id: 8, userId: 5, channelId: null, settings: { display: { color: '#fff' } }, createdAt: 2, updatedAt: 3 }],
      songs: [backupSong],
      setlists: [{ id: 20, title: 'Restored', description: null, items: [{ type: 'song', songId: 12 }], uploadedBy: 5, isPublic: true, createdAt: 4 }],
    },
  };
  await createArchive(file, manifest);
  const config = { corsOrigin: 'http://localhost:3000', port: 3000 };
  let savedEnv = null;
  try {
    const opened = await openBaryMusic(file);
    await exec(`INSERT INTO users (id, username, passwordHash, isAdmin) VALUES (99, 'existing', 'hash', 1)`);
    await assert.rejects(
      restoreBackup(db, opened, { audioDir, notesDir, config, updateEnvFile: () => {}, requireEmpty: true }),
      /no longer available/
    );
    assert.equal((await all('SELECT username FROM users'))[0].username, 'existing');
    await exec('DELETE FROM users');
    await restoreBackup(db, opened, { audioDir, notesDir, config, updateEnvFile: values => { savedEnv = values; } });
    assert.deepEqual((await all('SELECT id, username, isAdmin FROM users')), [{ id: 5, username: 'admin', isAdmin: 1 }]);
    assert.equal((await all('SELECT id FROM songs'))[0].id, 12);
    assert.equal((await all('SELECT id FROM setlists'))[0].id, 20);
    assert.equal((await all('SELECT * FROM sessions')).length, 0);
    assert.equal(savedEnv.ADMINS, 'admin');
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
