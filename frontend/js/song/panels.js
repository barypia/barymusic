/* ==================== SYSTEM PANELI ==================== */

const viewsList = [
    'songlist',
    'setlists',
    'queue',
    'socket',
    'sheets',
    'audio',
    'songInfo',
    'text'
];

function loadColumnLayout() {
    return settings.layout;
}

function savePanelLayout() {
	updateSettings(settings => { settings.layout = { ...columnLayout }; }, { apply: false });
}

const columnLayout = loadColumnLayout();

function renderAllPanels() {
    for (const viewName of viewsList) {
        refreshPanelContent[viewName]();
    }
}

function toggleRightColumn() {
    const rightColumn = document.getElementById('rightColumn');
    const isClosed = rightColumn.classList.contains('closed');

    if (isClosed) {
        rightColumn.style.width = `${columnLayout.right}px`;
        rightColumn.classList.remove('closed');
        columnLayout["right-closed"] = false;
        savePanelLayout();
        setElementDisplay('#mainContainer-tab-socket', true);
        setElementDisplay('#mainContainer-tab-audio', true);
        setElementDisplay('#mainContainer-tab-songInfo', true);
    } else {
        rightColumn.style.width = '10px';
        columnLayout["right-closed"] = true;
        savePanelLayout();
        setTimeout(() => {
            rightColumn.classList.add('closed');
            setElementDisplay('#mainContainer-tab-socket', false);
            setElementDisplay('#mainContainer-tab-audio', false);
            setElementDisplay('#mainContainer-tab-songInfo', false);
        }, 250);
    }
}

function applyInitialColumnLayout() {
    const rightColumn = document.getElementById('rightColumn');
    if (!rightColumn) return;

    if (columnLayout["right-closed"]) {
        rightColumn.style.width = '10px';
        rightColumn.classList.add('closed');
        setElementDisplay('#mainContainer-tab-socket', false);
        setElementDisplay('#mainContainer-tab-audio', false);
        setElementDisplay('#mainContainer-tab-songInfo', false);
    } else {
        rightColumn.style.width = `${columnLayout.right}px`;
        rightColumn.classList.remove('closed');
        setElementDisplay('#mainContainer-tab-socket', true);
        setElementDisplay('#mainContainer-tab-audio', true);
        setElementDisplay('#mainContainer-tab-songInfo', true);
    }
}

window.addEventListener('i18nReady', () => {
    applyInitialColumnLayout();
});

function setDoubleViewSettingsVisible(visible) {
	const settings = document.getElementById('doubleViewSettings');

	settings.classList.toggle('hidden', !visible);
	settings.setAttribute('aria-hidden', String(!visible));
}

function switchModalTabDoubleView(prefix, btn) {
	const DOUBLE_PANES = ['text', 'sheets'];

	const tabNames = Array.from(btn.closest('.modal-tabs').querySelectorAll('.modal-tab[data-tab]')).map(b => b.dataset.tab);

	btn.closest('.modal-tabs').querySelectorAll('.modal-tab').forEach(function (b) { b.classList.remove('active'); });
	btn.classList.add('active');

	tabNames.forEach(function (t) {
		const el = document.getElementById(prefix + '-tab-' + t);
		if (el) el.classList.toggle('hidden', !DOUBLE_PANES.includes(t));
	});

	setDoubleViewSettingsVisible(true);
}
