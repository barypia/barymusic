/* ==================== KOMPONENTY UI ==================== */

let activeCustomSelectMenu = null;

function updateCustomSelectLabel(select) {
    const trigger = select.__customTrigger;
    if (!trigger) return;
    const label = select.options[select.selectedIndex]?.textContent.trim() || select.value;
    trigger.querySelector('[data-label]').textContent = label;
    trigger.setAttribute('aria-label', label);
}

function closeCustomSelectMenu() {
    if (!activeCustomSelectMenu) return;
    activeCustomSelectMenu.remove();
    activeCustomSelectMenu.__trigger?.setAttribute('aria-expanded', 'false');
    activeCustomSelectMenu = null;
}

function openCustomSelectMenu(select, trigger) {
    closeCustomSelectMenu();
    const menu = document.createElement('div');
    menu.__trigger = trigger;
    menu.className = `editor-section-menu context-menu ${select.id === 'languageSetup' ? 'editor-section-menu--lang' : ''}`;

    Array.from(select.options).forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = option.textContent.trim();
        item.className = option.selected && select.id ? 'editor-menu-item editor-menu-item--active' : 'editor-menu-item';
        if (option.hasAttribute('style')) item.setAttribute('style', option.getAttribute('style'));
        item.addEventListener('click', event => {
            event.stopPropagation();
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeCustomSelectMenu();
        });
        menu.appendChild(item);
    });

    document.body.appendChild(menu);
    activeCustomSelectMenu = menu;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
        const triggerRect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const left = Math.min(triggerRect.left, window.innerWidth - menuRect.width - 8);
        const top = triggerRect.bottom + menuRect.height + 6 > window.innerHeight
            ? triggerRect.top - menuRect.height - 6
            : triggerRect.bottom + 6;
        menu.style.left = `${Math.max(8, left)}px`;
        menu.style.top = `${Math.max(8, top)}px`;
    });
}

function createCustomSelect(select) {
    if (select.dataset.customSelectEnhanced) return;
    select.dataset.customSelectEnhanced = '1';
    setElementDisplay(select, false);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span data-label style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span><i data-lucide="chevron-down" style="flex-shrink:0;"></i>';
    Object.assign(trigger.style, {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        minWidth: '110px', maxWidth: '220px', padding: '0.375rem 0.75rem', borderRadius: '8px',
        border: '1px solid rgba(59, 130, 246, 0.25)', background: 'rgba(30, 30, 30, 0.9)',
        color: 'var(--text-primary)', fontSize: '0.875rem', cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
    });
    trigger.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        activeCustomSelectMenu?.__trigger === trigger ? closeCustomSelectMenu() : openCustomSelectMenu(select, trigger);
    });
    select.__customTrigger = trigger;
    select.insertAdjacentElement('afterend', trigger);
    select.addEventListener('change', () => updateCustomSelectLabel(select));
    lucide.createIcons({ nodes: [trigger] });
}

function refreshCustomSelects(root = document) {
    root.querySelectorAll('select:not([data-native-select])').forEach(select => {
        createCustomSelect(select);
        updateCustomSelectLabel(select);
    });
}

document.addEventListener('click', event => {
    if (!activeCustomSelectMenu || activeCustomSelectMenu.contains(event.target) || activeCustomSelectMenu.__trigger?.contains(event.target)) return;
    closeCustomSelectMenu();
}, true);

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCustomSelectMenu();
});

refreshCustomSelects();
new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.('select:not([data-native-select])')) createCustomSelect(node);
        node.querySelectorAll?.('select:not([data-native-select])').forEach(createCustomSelect);
    }));
}).observe(document.body, { childList: true, subtree: true });

function initDropdowns() {
    document.addEventListener('click', function(e) {
        const trigger = e.target.closest('[data-dropdown-toggle]');
        if (trigger) {
            const targetId = trigger.getAttribute('data-dropdown-toggle');
            const menu = document.getElementById(targetId);
            if (!menu) return;
            const isOpen = menu.classList.contains('dropdown-open');
            closeAllPopups();
            if (!isOpen) {
                menu.classList.add('dropdown-open');
                trigger.setAttribute('aria-expanded', 'true');
                requestAnimationFrame(() => {
                    const rect = menu.getBoundingClientRect();
                    const backdrop = document.getElementById('popupBackdrop');
                    backdrop.style.top = (rect.top + 8) + 'px'; // 6px z popup + 2px do wyrównania
                    backdrop.style.left = rect.left + 'px';
                    backdrop.style.width = rect.width + 'px';
                    backdrop.style.height = rect.height + 'px';
                    backdrop.classList.add('active');
                });
            }
        } else if (!e.target.closest('.popup')) {
            closeAllDropdowns();
        }
    });

    document.getElementById('popupBackdrop').addEventListener('click', function() {
        closeAllDropdowns();
    });
}

function closeAllDropdowns() {
    document.querySelectorAll('.popup.dropdown-open').forEach(p => {
        p.classList.remove('dropdown-open');
    });
    document.querySelectorAll('[data-dropdown-toggle]').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
    });
    const backdrop = document.getElementById('popupBackdrop');
    if (backdrop) backdrop.classList.remove('active');
}

function closeAllPopups() {
    closeAllDropdowns();
    if (typeof closeContextMenu === 'function') closeContextMenu();
    if (typeof closeEditorPopup === 'function') closeEditorPopup();
}

function initModals() {
    document.addEventListener('click', function(e) {
        const trigger = e.target.closest('[data-modal-target]');
        if (trigger) {
            openModal(trigger.getAttribute('data-modal-target'));
            return;
        }
        if (e.target.classList.contains('modal-backdrop')) { if (!hasOpenPersistentModal()) closeAllModals(); }
        if (e.target.closest('[data-modal-dismiss]')) closeTopNonPersistentModal();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeTopNonPersistentModal();
    });
}

function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.querySelector('.modal-dialog')?.classList.remove('modal-dialog--wide');
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) { modalBody.style.height = ''; modalBody.style.overflow = ''; modalBody.style.transition = ''; }
    if (id === 'loginModal') {
		setButtonLoading(document.getElementById('loginBtn'), false);
        const name = document.getElementById('loginName');
        const pass = document.getElementById('loginPassword');
        const info = document.getElementById('loginInfo');
        if (name) name.value = '';
        if (pass) pass.value = '';
        if (info) info.value = '';
    } else if (id === 'registerModal') {
		setButtonLoading(document.getElementById('registerBtn'), false);
        const name = document.getElementById('registerName');
        const pass1 = document.getElementById('registerPassword1');
        const pass2 = document.getElementById('registerPassword2');
        const info = document.getElementById('registerInfo');
        if (name) name.value = '';
        if (pass1) pass1.value = '';
        if (pass2) pass2.value = '';
        if (info) info.value = '';
    } else if (id === 'channelDisplaySettingsModal') {
        if (typeof initSettings === 'function') {
            initSettings();
        }
    } else if (id === 'settingsModal') {
        setButtonLoading(document.getElementById('logoutBtn'), false);
        modal.querySelector('.modal-dialog').classList.add('modal-dialog--wide');
        if (typeof initSettings === 'function') {
            initSettings();
        }
        if (typeof loadAdminSettings === 'function') loadAdminSettings();
    } else if (id === 'songModal') {
        setButtonLoading(document.getElementById('songSubmitBtn'), false);
    } else if (id === 'setlistModal') {
        setButtonLoading(document.getElementById('setlistSubmitBtn'), false);
    }

    const alreadyOpen = document.querySelector('.modal-open');
    let backdrop = document.querySelector('.modal-backdrop');
    if (!alreadyOpen || alreadyOpen === modal) {
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            document.body.appendChild(backdrop);
        }
        requestAnimationFrame(() => backdrop.classList.add('modal-backdrop-visible'));
        modal.removeAttribute('data-opened-over');
    } else {
        const persistent = document.querySelector('.modal-open[data-modal-persistent]');
        if (persistent && persistent !== modal) {
            persistent.classList.add('modal-hidden-by-overlay');
            const pd = persistent.querySelector('.modal-dialog');
            if (pd) pd.classList.remove('modal-dialog-visible');
            modal.setAttribute('data-opened-over', persistent.id);
        }
    }
    modal.classList.add('modal-open');
    modal.removeAttribute('aria-hidden');
    document.body.classList.add('modal-active');
    requestAnimationFrame(() => {
        const dialog = modal.querySelector('.modal-dialog');
        if (dialog) dialog.classList.add('modal-dialog-visible');
    });
    setTimeout(() => {
        const inp = modal.querySelector('input');
        if (inp) inp.focus();
    }, 100);
}

function hasOpenPersistentModal() {
    return !!document.querySelector('.modal-open[data-modal-persistent]');
}

function closeTopNonPersistentModal() {
    const nonPersistent = [...document.querySelectorAll('.modal-open')]
        .filter(m => !m.hasAttribute('data-modal-persistent'));
    if (nonPersistent.length > 0) {
        closeAllModals();
    } else if (!hasOpenPersistentModal()) {
        closeAllModals();
    }
}

function closeAllModals(includePersistent = false) {
    const editAudio = document.getElementById('editModalAudioPlayer');
    if (editAudio && !editAudio.paused) editAudio.pause();

    const backdrops = document.querySelectorAll('.modal-backdrop');
    let modals = [...document.querySelectorAll('.modal-open')]
        .filter(m => includePersistent || !m.hasAttribute('data-modal-persistent'));

    // Zbierz ID modali do których wrócić (przez data-opened-over)
    const restoreIds = new Set();
    if (!includePersistent) {
        modals.forEach(m => {
            const overId = m.getAttribute('data-opened-over');
            if (overId) restoreIds.add(overId);
        });
        modals = modals.filter(m => !restoreIds.has(m.id));
    }

    const persistentRemains = !includePersistent && (
        !!document.querySelector('.modal-open[data-modal-persistent]') || restoreIds.size > 0
    );
    document.activeElement?.blur();
    modals.forEach(m => {
        const dialog = m.querySelector('.modal-dialog');
        if (dialog) dialog.classList.remove('modal-dialog-visible');
    });
    if (!persistentRemains) {
        backdrops.forEach(b => b.classList.remove('modal-backdrop-visible'));
    }
    setTimeout(() => {
        modals.forEach(m => { m.classList.remove('modal-open'); m.removeAttribute('data-opened-over'); m.setAttribute('aria-hidden', 'true'); });
        if (!persistentRemains) {
            backdrops.forEach(b => b.remove());
            document.body.classList.remove('modal-active');
        } else {
            // Przywróć persistent modal ukryty przez overlay
            const hidden = restoreIds.size > 0
                ? [...restoreIds].map(id => document.getElementById(id)).find(m => m?.classList.contains('modal-hidden-by-overlay'))
                : document.querySelector('.modal-open[data-modal-persistent].modal-hidden-by-overlay');
            if (hidden?.classList.contains('modal-open')) {
                hidden.classList.remove('modal-hidden-by-overlay');
                requestAnimationFrame(() => {
                    const pd = hidden.querySelector('.modal-dialog');
                    if (pd) pd.classList.add('modal-dialog-visible');
                });
            }
        }
        // Jeśli zamknięty modal był otwarty nad connectModal (setup), wróć do setupu
        if (restoreIds.has('connectModal')) {
            const connectModal = document.getElementById('connectModal');
            if (connectModal && !connectModal.classList.contains('modal-open')) {
                openModal('connectModal');
                connectModalShowStart();
            }
        }
    }, 250);
}

function animateModalResize(containerEl, from, to, watchEl, watchFrom, watchTo) {
    if (!containerEl) return;
    // Animuj max-width watchEl zsynchronizowanie z height
    if (watchEl && watchFrom !== watchTo) {
        watchEl.style.transition = 'none';
        watchEl.style.maxWidth = watchFrom;
        watchEl.offsetHeight;
        watchEl.style.transition = 'max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        watchEl.style.maxWidth = watchTo;
        watchEl.addEventListener('transitionend', function wCleanup(e) {
            if (e.propertyName !== 'max-width') return;
            watchEl.removeEventListener('transitionend', wCleanup);
            watchEl.style.transition = '';
            watchEl.style.maxWidth = '';
        });
    }
    if (Math.abs(from - to) < 1) return;
    containerEl.style.transition = 'none';
    containerEl.style.height = from + 'px';
    containerEl.style.overflow = 'hidden';
    containerEl.offsetHeight;
    containerEl.style.transition = 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    containerEl.style.height = to + 'px';
    containerEl.addEventListener('transitionend', function cleanup(e) {
        if (e.propertyName !== 'height') return;
        containerEl.removeEventListener('transitionend', cleanup);
        containerEl.style.overflow = '';
        containerEl.style.transition = '';
        containerEl.style.height = '';
    });
}

/* ==================== TOASTY ==================== */

const TOAST_ICONS = {
    info:    'info',
    success: 'check',
    error:   'x',
    warning: 'triangle-alert',
};

function getToastContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }
    return container;
}

/**
 * @param {string} message        Główna treść toastu
 * @param {'info'|'success'|'error'|'warning'} [type='info']
 * @param {number}  [duration=3500]
 * @param {string}  [subtitle]    Opcjonalna druga linia tekstu
 */
function showToast(type = 'info', message, subtitle = null, duration = null) {
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = `<i data-lucide="${TOAST_ICONS[type] ?? TOAST_ICONS.info}"></i>`;

    const body = document.createElement('div');
    body.className = 'toast-body';

    const title = document.createElement('span');
    title.className = 'toast-title';
    title.textContent = message;
    body.appendChild(title);

    if (subtitle) {
        const sub = document.createElement('span');
        sub.className = 'toast-subtitle';
        sub.textContent = subtitle;
        body.appendChild(sub);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '<i data-lucide="x"></i>';
    closeBtn.setAttribute('aria-label', i18n.t('common.close'));

    toast.appendChild(icon);
    toast.appendChild(body);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    lucide.createIcons({ nodes: [icon, closeBtn] });

    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));

    const dismiss = () => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    };

    if (!duration) {
        if (type == 'success') {
            duration = 3000;
        } else {
            duration = 5000;
        }
    }

    const timer = setTimeout(dismiss, duration);
    closeBtn.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

document.querySelectorAll('.accordion-header').forEach(header => {
    const item = header.parentElement;
    const content = header.nextElementSibling;
    
    let heightUpdateFrame;
    const syncOpenHeight = () => {
        cancelAnimationFrame(heightUpdateFrame);
        heightUpdateFrame = requestAnimationFrame(() => {
            if (item.classList.contains('open')) {
                content.style.maxHeight = content.scrollHeight + 'px';
            }
        });
    };

    const resizeObserver = new ResizeObserver(syncOpenHeight);
    Array.from(content.children).forEach(child => resizeObserver.observe(child));

    const mutationObserver = new MutationObserver(() => {
        Array.from(content.children).forEach(child => resizeObserver.observe(child));
        syncOpenHeight();
    });
    mutationObserver.observe(content, { childList: true, subtree: true, characterData: true });

    item.classList.remove('open');
    content.style.maxHeight = null;
    header.querySelector('.view-header-controls').classList.add('hidden!')

    header.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');

        if (isOpen) {
            item.classList.remove('open');
            content.style.maxHeight = null;
            header.querySelector('.view-header-controls').classList.add('hidden!')
        } else {
            item.classList.add('open');
            syncOpenHeight();
            header.querySelector('.view-header-controls').classList.remove('hidden!')
        }
    });
});

document.querySelectorAll('.accordion-header .btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
        event.stopPropagation();
    });
});

// Przełącz zakładki modalu (Informacje / Tekst / Pliki)
function switchModalTab(prefix, tab, btn, noAnimation) {
	const isActiveTab = btn.classList.contains('active');
	const submenuId = btn.dataset.settingsSubmenu;
	if (prefix === 'settings' && submenuId && isActiveTab) {
		toggleSettingsSubmenu(submenuId);
		return;
	}

	const modalBody = btn.closest('.modal-content')?.querySelector('.modal-body');
	const tabNames = Array.from(btn.closest('.modal-tabs').querySelectorAll('.modal-tab[data-tab]')).map(b => b.dataset.tab);
	const currentPane = tabNames.map(t => document.getElementById(prefix + '-tab-' + t)).find(el => el && !el.classList.contains('hidden'));
	const nextPane = document.getElementById(prefix + '-tab-' + tab);

	btn.closest('.modal-tabs').querySelectorAll('.modal-tab').forEach(function (b) { b.classList.remove('active'); });
	btn.classList.add('active');

	const dialog = btn.closest('.modal-dialog');
	const mediaColId = prefix === 'song' ? 'songMediaCol' : null;
	const mediaCol = mediaColId ? document.getElementById(mediaColId) : null;

	function doSwitch() {
		if (dialog) {
			const hasMedia = tab === 'lyrics' && mediaCol && !mediaCol.classList.contains('hidden');
			const isSetlistItems = prefix === 'setlist' && tab === 'items';
			// Settings modal keeps its wide layout regardless of the active tab.
			if (prefix !== 'settings') {
				dialog.classList.toggle('modal-dialog--wide', hasMedia || isSetlistItems);
			}
		}
		tabNames.forEach(function (t) {
			const el = document.getElementById(prefix + '-tab-' + t);
			if (el) el.classList.toggle('hidden', t !== tab);
		});
        if (nextPane) {
            nextPane.classList.add('modal-tab-pane', 'tab-fade-in');
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    nextPane.classList.remove('tab-fade-in');
                });
            });
        }
		if (tab === 'lyrics') {
			const editorId = prefix + 'LyricsEditor';
			const { jsonTextarea, addBtn } = getEditorElements(editorId);
			const isJson = jsonTextarea && !jsonTextarea.classList.contains('hidden');
			if (addBtn) collapseEditorBtn(addBtn, isJson);
			requestAnimationFrame(function () { requestAnimationFrame(function () { resizeAllTextareas(editorId); }); });
		}
	}

	if (currentPane && currentPane !== nextPane && !noAnimation) {
		currentPane.classList.add('modal-tab-pane', 'tab-fade-out');
		setTimeout(function () {
			currentPane.classList.remove('modal-tab-pane', 'tab-fade-out');
			if (modalBody) {
				const from = modalBody.offsetHeight;
				const watchFrom = dialog ? getComputedStyle(dialog).maxWidth : null;
				doSwitch();
				const to = modalBody.offsetHeight;
				const watchTo = dialog ? getComputedStyle(dialog).maxWidth : null;
				animateModalResize(modalBody, from, to, dialog || null, watchFrom, watchTo);
			} else {
				doSwitch();
			}
		}, 150);
	} else {
		doSwitch();
		if (modalBody) { modalBody.style.height = ''; }
	}
}
