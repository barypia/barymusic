/* ==================== NUTY (VIEWER) ==================== */

let sheetZoom = 1;
let translateX = 0;
let translateY = 0;
let _sheetDraggingCleanup = null;

function destroySheetDragging() {
	_sheetDraggingCleanup?.();
	_sheetDraggingCleanup = null;
}

function initSheetDragging() {
	destroySheetDragging();
	const viewer = document.getElementById("sheetViewer");
	const sheet = viewer ? viewer.querySelector("img, svg") : null;

	if (!viewer || !sheet) return;
	const controller = new AbortController();
	const { signal } = controller;

	// Reaguj na zmianę rozmiaru kontenera (np. resize panelu lub okna)
	const resizeObserver = new ResizeObserver(() => {
		fitSheetToWidth();
	});
	resizeObserver.observe(viewer);

	let isDragging = false;
	let startX = 0;
	let startY = 0;
	let currentTranslateX = 0;
	let currentTranslateY = 0;

	function updateTransform() {
		sheet.style.transform = `scale(${sheetZoom}) translate(${translateX}px, ${translateY}px)`;
	}

	viewer.addEventListener("mousedown", (e) => {
		isDragging = true;
		viewer.style.cursor = 'grabbing';
		startX = e.clientX;
		startY = e.clientY;
		currentTranslateX = translateX;
		currentTranslateY = translateY;
		e.preventDefault();
	}, { signal });

	document.addEventListener("mousemove", (e) => {
		if (!isDragging) return;
		e.preventDefault();

		const dx = e.clientX - startX;
		const dy = e.clientY - startY;

		translateX = currentTranslateX + dx / sheetZoom;
		translateY = currentTranslateY + dy / sheetZoom;

		updateTransform();
	}, { signal });

	document.addEventListener("mouseup", () => {
		if (isDragging) {
			isDragging = false;
			viewer.style.cursor = 'grab';
			updateFitBtn();
		}
	}, { signal });

	viewer.addEventListener("touchstart", (e) => {
		const touch = e.touches[0];
		isDragging = true;
		startX = touch.clientX;
		startY = touch.clientY;
		currentTranslateX = translateX;
		currentTranslateY = translateY;
	}, { passive: true, signal });

	document.addEventListener("touchmove", (e) => {
		if (!isDragging) return;

		const touch = e.touches[0];
		const dx = touch.clientX - startX;
		const dy = touch.clientY - startY;

		translateX = currentTranslateX + dx / sheetZoom;
		translateY = currentTranslateY + dy / sheetZoom;

		updateTransform();
	}, { passive: true, signal });

	document.addEventListener("touchend", () => {
		isDragging = false;
		updateFitBtn();
	}, { signal });

	_sheetDraggingCleanup = () => {
		controller.abort();
		resizeObserver.disconnect();
		isDragging = false;
		viewer.style.cursor = '';
	};
}

function fitSheetToWidth() {
	const viewer = document.getElementById('sheetViewer');
	const img = viewer ? viewer.querySelector('img, svg') : null;

	if (!viewer || !img) return;

	if (!img.complete || img.naturalWidth === 0) {
		img.onload = () => fitSheetToWidth();
		return;
	}

	const availableWidth = viewer.clientWidth;
	const imgWidth = img.naturalWidth || img.width.baseVal?.value;

	if (availableWidth <= 0 || imgWidth <= 0) return;

	sheetZoom = 1;
	translateX = 0;
	translateY = 0;

	// Obraz wypełnia 100% szerokości viewera przez CSS; scale używany tylko do zoomu.
	img.style.width = '100%';
	img.style.height = 'auto';
	img.style.transformOrigin = 'top center';
	img.style.transform = 'scale(1) translate(0, 0)';
	updateFitBtn();
}

function isSheetsAtFit() {
	const epsilon = 0.0001;
	return Math.abs(sheetZoom - 1) < epsilon
		&& Math.abs(translateX) < epsilon
		&& Math.abs(translateY) < epsilon;
}

function updateFitBtn() {
	const controls = document.getElementById('mainContainer-tab-sheets').querySelector('.sheet-floating-controls');
	const btn = document.getElementById('mainContainer-tab-sheets').querySelector('[data-action="zoom-reset"]');
	if (!btn) return;

	const visible = !isSheetsAtFit();
	controls.classList.toggle('has-zoom-reset', visible);
	btn.disabled = !visible;
	btn.setAttribute('aria-hidden', String(!visible));
}

function zoomSheet(delta) {
	const viewer = document.getElementById('sheetViewer');
	const img = viewer?.querySelector('img, svg');
	if (!viewer || !img) return;

	sheetZoom = Math.max(0.25, Math.min(5, sheetZoom + delta));
	img.style.transform = `scale(${sheetZoom}) translate(${translateX}px, ${translateY}px)`;
	updateFitBtn();
}

// Scrolluje nuty do zapisanej pozycji { y, relativeZoom }
// relativeZoom jest względny wobec fitZoom, więc działa niezależnie od szerokości panelu
function scrollSheetToY(anchor) {
	const viewer = document.getElementById('sheetViewer');
	const img = viewer?.querySelector('img, svg');
	if (!viewer || !img) return;

	if (anchor.relativeZoom !== undefined) {
		sheetZoom = anchor.relativeZoom;
	}

	// Wysokość obrazu w pikselach CSS (przy scale=1, czyli bez zoomu)
	const imgCssHeight = img.getBoundingClientRect().height / sheetZoom || img.clientHeight;
	const viewerHeight = viewer.clientHeight;

	const targetPx = anchor.y * imgCssHeight;
	translateY = -(targetPx - viewerHeight / (2 * sheetZoom));
	translateX = 0;

	img.style.transform = `scale(${sheetZoom}) translate(${translateX}px, ${translateY}px)`;
	updateFitBtn();
}

// Odczytuje aktualną pozycję jako { y, relativeZoom }
function getSheetAnchor() {
	const viewer = document.getElementById('sheetViewer');
	const img = viewer?.querySelector('img, svg');
	if (!viewer || !img) return null;

	const imgCssHeight = img.getBoundingClientRect().height / sheetZoom || img.clientHeight;
	if (!imgCssHeight) return null;

	const viewerHeight = viewer.clientHeight;
	const centerPx = -translateY + viewerHeight / (2 * sheetZoom);
	return {
		y: Math.max(0, Math.min(1, centerPx / imgCssHeight)),
		relativeZoom: sheetZoom,
	};
}

// Context menu - sheets
function _openSheetsContextMenu(pos, trigger) {
	const canEdit = currentIsAdmin || (currentUser && currentUser === currentSong?.uploadedByUsername);

	const items = [
		{
			icon: 'zoom-in',
			label: i18n.t('common.zoom_in'),
			action: () => { zoomSheet(0.1); updateFitBtn(); }
		},
		{
			icon: 'zoom-out',
			label: i18n.t('common.zoom_out'),
			action: () => { zoomSheet(-0.1); updateFitBtn(); }
		},
		{
			icon: 'maximize-2',
			label: i18n.t('songs.zoom_reset'),
			action: () => { fitSheetToWidth(); updateFitBtn(); }
		},
		{ separator: true },
		{
			icon: 'file-image',
			label: i18n.t('songs.manage_sheets'),
			disabled: !canEdit,
			action: () => editSongOnTab('files')
		}
	];

	showContextMenu(items, pos, trigger);
}
