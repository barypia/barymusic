/* ==================== GLOBALNE MENU KONTEKSTOWE ==================== */

const _contextMenuBindings = new WeakMap();

function addContextMenu(el, callback) {
	const existingBinding = _contextMenuBindings.get(el);
	if (existingBinding) {
		existingBinding.callback = callback;
		return;
	}

	let _lpTimer    = null;
	let _lpMoved    = false;
	let _lpPos      = null;
	let _lpFired    = false;
	let binding;

	const onContextMenu = (e) => {
		e.preventDefault();
		binding.callback({ x: e.clientX, y: e.clientY });
	};

	const onTouchStart = (e) => {
		if (e.touches.length !== 1) return;
		_lpMoved = false;
		_lpFired = false;
		_lpPos   = { x: e.touches[0].clientX, y: e.touches[0].clientY };
		_lpTimer = setTimeout(() => {
			if (_lpMoved) return;
			_lpFired = true;
			navigator.vibrate?.(30);
			binding.callback(_lpPos);
		}, 500);
	};

	const onTouchMove = (e) => {
		if (!_lpTimer) return;
		const t = e.touches[0];
		const dx = t.clientX - _lpPos.x;
		const dy = t.clientY - _lpPos.y;
		if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
			_lpMoved = true;
			clearTimeout(_lpTimer);
			_lpTimer = null;
		}
	};

	const onTouchEnd = (e) => {
		clearTimeout(_lpTimer);
		_lpTimer = null;
		if (_lpFired) {
			e.preventDefault();
			_lpFired = false;
		}
	};

	const onTouchCancel = () => {
		clearTimeout(_lpTimer);
		_lpTimer = null;
		_lpFired = false;
	};

	binding = {
		callback,
		onContextMenu,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		onTouchCancel
	};
	_contextMenuBindings.set(el, binding);

	el.addEventListener('contextmenu', onContextMenu);
	el.addEventListener('touchstart', onTouchStart, { passive: true });
	el.addEventListener('touchmove', onTouchMove, { passive: true });
	el.addEventListener('touchend', onTouchEnd);
	el.addEventListener('touchcancel', onTouchCancel, { passive: true });
}

function removeContextMenu(el) {
	const binding = _contextMenuBindings.get(el);
	if (!binding) return;

	binding.onTouchCancel();
	el.removeEventListener('contextmenu', binding.onContextMenu);
	el.removeEventListener('touchstart', binding.onTouchStart);
	el.removeEventListener('touchmove', binding.onTouchMove);
	el.removeEventListener('touchend', binding.onTouchEnd);
	el.removeEventListener('touchcancel', binding.onTouchCancel);
	_contextMenuBindings.delete(el);

	if (_activeContextMenu?._trigger === el) closeContextMenu();
}

let _activeContextMenu = null;

function _removeContextMenu(menu) {
	if (!menu) return;
	if (menu._subMenu) _removeContextMenu(menu._subMenu);
	menu._cleanup?.forEach(cleanup => cleanup());
	menu._cleanup = [];
	menu.remove();
}

function closeContextMenu() {
	if (!_activeContextMenu) return;
	_activeContextMenu._trigger?.setAttribute('aria-expanded', 'false');
	_removeContextMenu(_activeContextMenu);
	_activeContextMenu = null;
	document.removeEventListener('click',       _onContextMenuOutsideClick);
	document.removeEventListener('contextmenu', _onContextMenuOutsideClick);
	document.removeEventListener('keydown',     _onContextMenuKeydown);
}

function _closeSubMenus(menu) {
	if (!menu || !menu._subMenu) return;
	_removeContextMenu(menu._subMenu);
	menu._subMenu = null;
}

function _isContextMenuTarget(target) {
	let menu = _activeContextMenu;
	while (menu) {
		if (menu.contains(target)) return true;
		menu = menu._subMenu;
	}
	return false;
}

function _onContextMenuOutsideClick(e) {
	if (_activeContextMenu && !_isContextMenuTarget(e.target)) {
		closeContextMenu();
	}
}

function _onContextMenuKeydown(e) {
	if (e.key === 'Escape') closeContextMenu();
}

function _positionContextMenu(menu, pos, parentMenu) {
	const mw = menu.offsetWidth;
	const mh = menu.offsetHeight;
	let x = pos.x;
	let y = pos.y;

	if (parentMenu) {
		const parentRect = parentMenu.getBoundingClientRect();
		let side = 'right';

		if (x + mw > window.innerWidth - 8) {
			x = parentRect.left - mw;
			side = 'left';
		} else {
			x = parentRect.right;
			side = 'right';
		}
		y -= 4;

		if (x < 8) x = 8;
		if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
		if (y < 8) y = 8;

		menu.dataset.submenuSide = side;
	} else {
		if (x + mw > window.innerWidth  - 8) x = window.innerWidth  - mw - 8;
		if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
		if (x < 8) x = 8;
		if (y < 8) y = 8;
	}

	menu.style.left = x + 'px';
	menu.style.top  = y + 'px';
}

function _getSubmenuSelectValues(select) {
	if (select.type === 'multi') {
		if (select.value instanceof Set) return [...select.value];
		return Array.isArray(select.value) ? select.value : [];
	}
	return [select.value];
}

function _isSubmenuSelectActive(select) {
	const values = new Set(_getSubmenuSelectValues(select));
	if (!Object.hasOwn(select, 'defaultValue')) return select.type === 'multi' ? values.size > 0 : select.value != null;

	if (select.type === 'single') return !Object.is(select.value, select.defaultValue);
	const defaults = new Set(select.defaultValue instanceof Set
		? select.defaultValue
		: (Array.isArray(select.defaultValue) ? select.defaultValue : []));
	return values.size !== defaults.size || [...values].some(value => !defaults.has(value));
}

function _createSubmenuSelectItems(select) {
	const selectedValues = new Set(_getSubmenuSelectValues(select));
	return (select.items || []).map(option => {
		if (!Object.hasOwn(option, 'value')) return option;

		const selected = selectedValues.has(option.value);
		const selectionIcon = select.type === 'multi'
			? (selected ? 'square-check' : 'square')
			: (selected ? 'circle-check' : 'circle');
		return {
			...option,
			icon: option.icon || selectionIcon,
			active: option.active ?? selected,
			closeOnSelect: option.closeOnSelect ?? false,
			_selection: { select, value: option.value },
			action: button => {
				if (select.type === 'multi') {
					if (selectedValues.has(option.value)) selectedValues.delete(option.value);
					else selectedValues.add(option.value);
					select.value = [...selectedValues];
					select.onChange?.([...selectedValues], option, button);
				} else {
					selectedValues.clear();
					const value = select.clearable && Object.is(select.value, option.value)
						? select.defaultValue
						: option.value;
					selectedValues.add(value);
					select.value = value;
					select.onChange?.(value, option, button);
				}
				_updateSubmenuSelectGroup(button, select, selectedValues);
				button?.closest('.context-menu')?._parentButton?.classList.toggle(
					'editor-menu-item--active',
					_isSubmenuSelectActive(select)
				);
				option.action?.(button);
				_refreshContextMenuDisabledStates();
				if (select.refreshParentOnChange) _refreshParentContextMenu(button);
			}
		};
	});
}

function _updateSubmenuSelectButton(button, selected, type) {
	if (!button) return;
	button.classList.toggle('editor-menu-item--active', selected);
	const currentIcon = button.querySelector('svg, i');
	if (!currentIcon) return;

	const icon = document.createElement('i');
	icon.dataset.lucide = type === 'multi'
		? (selected ? 'square-check' : 'square')
		: (selected ? 'circle-check' : 'circle');
	currentIcon.replaceWith(icon);
	lucide.createIcons({ nodes: [button] });
}

function _updateSubmenuSelectGroup(button, select, selectedValues) {
	const menu = button?.closest('.context-menu');
	if (!menu) return;
	menu.querySelectorAll('.editor-menu-item').forEach(optionButton => {
		const selection = optionButton._contextMenuSelection;
		if (selection?.select !== select) return;
		_updateSubmenuSelectButton(optionButton, selectedValues.has(selection.value), select.type);
	});
}

function _resolveContextSubmenu(item) {
	if (Array.isArray(item.submenu)) return { items: item.submenu, active: item.active };
	if (item.submenu?.type === 'range') {
		const value = item.submenu.value || {};
		const rangeItems = [];
		if (item.submenu.missingItem) {
			rangeItems.push({
				icon: value.includeMissing ? 'square-check' : 'square',
				label: item.submenu.missingItem.label,
				active: !!value.includeMissing,
				closeOnSelect: false,
				action: button => {
					value.includeMissing = !value.includeMissing;
					item.submenu.value = value;
					_updateSubmenuSelectButton(button, value.includeMissing, 'multi');
					item.submenu.onChange?.({ ...value });
					button.closest('.context-menu')?._parentButton?.classList.toggle(
						'editor-menu-item--active',
						value.min != null || value.max != null || value.includeMissing
					);
					_refreshContextMenuDisabledStates();
				}
			});
			rangeItems.push({ separator: true });
		}
		rangeItems.push({ range: item.submenu });
		return {
			items: rangeItems,
			active: item.active ?? (value.min != null || value.max != null || value.includeMissing)
		};
	}
	if (item.submenu?.type === 'single' || item.submenu?.type === 'multi') {
		const items = _createSubmenuSelectItems(item.submenu);
		if (item.submenu.searchable) {
			items.unshift({
				search: {
					select: item.submenu,
					placeholder: typeof item.submenu.searchable === 'object'
						? item.submenu.searchable.placeholder
						: ''
				}
			});
		}
		return {
			items,
			active: item.active ?? _isSubmenuSelectActive(item.submenu)
		};
	}
	return { items: [], active: item.active };
}

function _isContextMenuItemDisabled(item) {
	return typeof item.disabled === 'function' ? item.disabled() : !!item.disabled;
}

function _isContextMenuItemVisible(item) {
	return typeof item.visible === 'function' ? item.visible() : item.visible !== false;
}

function _refreshContextMenuDisabledStates() {
	let menu = _activeContextMenu;
	while (menu) {
		menu.querySelectorAll('.editor-menu-item').forEach(button => {
			if (button._contextMenuItem) button.disabled = _isContextMenuItemDisabled(button._contextMenuItem);
		});
		menu = menu._subMenu;
	}
}

function _createContextMenuRange(range) {
	const control = document.createElement('div');
	control.className = 'editor-menu-range';
	const createInput = (side, label) => {
		const input = document.createElement('input');
		input.type = 'number';
		input.className = 'editor-menu-range__input';
		input.placeholder = label;
		input.setAttribute('aria-label', label);
		if (range.bounds?.min != null) input.min = String(range.bounds.min);
		if (range.bounds?.max != null) input.max = String(range.bounds.max);
		if (range.step != null) input.step = String(range.step);
		if (range.value?.[side] != null) input.value = String(range.value[side]);
		input.addEventListener('input', () => {
			const value = input.value === '' ? null : Number(input.value);
			range.value = { ...(range.value || {}), [side]: Number.isFinite(value) ? value : null };
			range.onChange?.({ ...range.value });
			control.closest('.context-menu')?._parentButton?.classList.toggle(
				'editor-menu-item--active',
				range.value.min != null || range.value.max != null || range.value.includeMissing
			);
			_refreshContextMenuDisabledStates();
		});
		return input;
	};
	control.append(
		createInput('min', range.labels?.min || 'Min'),
		Object.assign(document.createElement('span'), { textContent: '–' }),
		createInput('max', range.labels?.max || 'Max')
	);
	return control;
}

function _createContextMenuSearch(search) {
	const wrapper = document.createElement('div');
	wrapper.className = 'editor-menu-search';
	const icon = document.createElement('i');
	icon.dataset.lucide = 'search';
	const input = document.createElement('input');
	input.type = 'search';
	input.className = 'editor-menu-search__input';
	input.placeholder = search.placeholder || '';
	input.setAttribute('aria-label', search.placeholder || 'Search');
	input.addEventListener('input', () => {
		const query = input.value.trim().toLocaleLowerCase();
		const menu = wrapper.closest('.context-menu');
		menu?.querySelectorAll('.editor-menu-item').forEach(button => {
			if (button._contextMenuItem?.searchable === false) return;
			const selection = button._contextMenuSelection;
			if (selection?.select !== search.select) return;
			const label = button.textContent.trim().toLocaleLowerCase();
			button.hidden = !!query && !label.includes(query);
			button.style.display = button.hidden ? 'none' : '';
		});
		requestAnimationFrame(() => menu?.querySelector('.context-menu__items')?._updateScrollFade?.());
	});
	wrapper.append(icon, input);
	return wrapper;
}

function _createContextMenu(items, pos, parentMenu) {
	const menu = document.createElement('div');
	const isSubmenu = !!parentMenu;
	const hasSearch = items.some(item => _isContextMenuItemVisible(item) && item.search);
	menu.className = 'editor-section-menu context-menu';
	if (hasSearch) menu.classList.add('context-menu--has-search');
	if (isSubmenu) menu.style.animation = 'none';
	menu.dataset.menuLevel = isSubmenu ? String(Number(parentMenu.dataset.menuLevel || '0') + 1) : '0';
	menu._parentMenu = parentMenu;
	menu._subMenu = null;
	menu._cleanup = [];

	const surface = hasSearch ? document.createElement('div') : menu;
	const controlsContainer = hasSearch ? document.createElement('div') : null;
	const itemsContainer = hasSearch ? document.createElement('div') : menu;
	if (hasSearch) {
		surface.className = 'context-menu__surface';
		controlsContainer.className = 'context-menu__controls';
		itemsContainer.className = 'context-menu__items';
		surface.appendChild(controlsContainer);
		surface.appendChild(itemsContainer);
		menu.appendChild(surface);
	}
	if (items.filter(item => item._selection).length > 12) {
		itemsContainer.classList.add(hasSearch ? 'context-menu__items--scrollable' : 'context-menu--scrollable');
		if (hasSearch) {
			const updateScrollFade = () => {
				itemsContainer.classList.toggle('context-menu__items--fade-top', itemsContainer.scrollTop > 1);
				itemsContainer.classList.toggle(
					'context-menu__items--fade-bottom',
					itemsContainer.scrollTop + itemsContainer.clientHeight < itemsContainer.scrollHeight - 1
				);
			};
			itemsContainer._updateScrollFade = updateScrollFade;
			itemsContainer.addEventListener('scroll', updateScrollFade, { passive: true });
			const resizeObserver = new ResizeObserver(updateScrollFade);
			resizeObserver.observe(itemsContainer);
			menu._cleanup.push(() => resizeObserver.disconnect());
			requestAnimationFrame(updateScrollFade);
		}
	}

	menu.addEventListener('pointermove', (e) => {
		if (!menu._subMenu) return;
		const hoveredItem = e.target.closest?.('.editor-menu-item');
		if (hoveredItem && hoveredItem !== menu._subMenu._parentButton) _closeSubMenus(menu);
	});

	items.forEach(item => {
		if (!_isContextMenuItemVisible(item)) return;
		if (item.search) {
			surface.insertBefore(_createContextMenuSearch(item.search), controlsContainer);
			return;
		}
		const itemContainer = hasSearch && item.sticky ? controlsContainer : itemsContainer;
		if (item.range) {
			itemContainer.appendChild(_createContextMenuRange(item.range));
			return;
		}

		if (item.separator) {
			const sep = document.createElement('div');
			sep.className = 'editor-menu-sep';
			itemContainer.appendChild(sep);
			return;
		}

		if (Object.hasOwn(item, 'content')) {
			const content = document.createElement('div');
			content.className = 'editor-menu-content';
			if (item.icon) {
				const icon = document.createElement('i');
				icon.dataset.lucide = item.icon;
				content.appendChild(icon);
			}
			const text = document.createElement('span');
			text.className = 'editor-menu-content__text';
			text.textContent = String(item.content ?? '');
			content.appendChild(text);
			itemContainer.appendChild(content);
			return;
		}

		const btn = document.createElement('button');
		btn.type = 'button';
		const submenu = _resolveContextSubmenu(item);
		const hasSubmenu = submenu.items.length > 0;
		btn.className = 'editor-menu-item' + (submenu.active ? ' editor-menu-item--active' : '') + (item.danger ? ' editor-menu-item--danger' : '') + (hasSubmenu ? ' editor-menu-item--submenu' : '');
		btn._contextMenuItem = item;
		if (item._selection) btn._contextMenuSelection = item._selection;
		btn.disabled = _isContextMenuItemDisabled(item);
		btn.innerHTML = `<i data-lucide="${item.icon}"></i> ${escapeHtml(item.label)}${hasSubmenu ? '<span class="editor-menu-item__arrow">›</span>' : ''}`;

		if (hasSubmenu && !btn.disabled) {
			btn.addEventListener('pointerenter', () => {
				_openSubMenu(menu, btn, _resolveContextSubmenu(item).items);
			});
		}

		if (!hasSubmenu) {
			btn.addEventListener('click', (e) => {
				if (item.closeOnSelect !== false) closeContextMenu();
				else e.stopPropagation();
				item.action?.(btn);
			});
		} else if (item.action && !btn.disabled) {
			btn.addEventListener('click', () => {
				closeContextMenu();
				item.action();
			});
		} else if (!btn.disabled) {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				_openSubMenu(menu, btn, _resolveContextSubmenu(item).items);
			});
		}

		itemContainer.appendChild(btn);
	});
	if (controlsContainer && !controlsContainer.childElementCount) controlsContainer.remove();

	document.body.appendChild(menu);
	lucide.createIcons({ nodes: [menu] });
	_positionContextMenu(menu, pos, parentMenu);
	if (isSubmenu) {
		requestAnimationFrame(() => {
			menu.style.animation = '';
			menu.classList.add('context-menu--submenu');
		});
	}
	return menu;
}

function _openSubMenu(parentMenu, parentBtn, items) {
	if (!items || !items.length) return;
	if (parentMenu._subMenu?._parentButton === parentBtn) {
		return parentMenu._subMenu;
	}

	_closeSubMenus(parentMenu);

	const rect = parentBtn.getBoundingClientRect();
	const submenu = _createContextMenu(items, { x: rect.right - 2, y: rect.top }, parentMenu);
	submenu._parentButton = parentBtn;
	parentMenu._subMenu = submenu;
	return submenu;
}

function _refreshParentContextMenu(button) {
	const changedMenu = button?.closest('.context-menu');
	const menuToRefresh = changedMenu?._parentMenu;
	const parentMenu = menuToRefresh?._parentMenu;
	const parentButton = menuToRefresh?._parentButton;
	if (!parentMenu || !parentButton?._contextMenuItem) return;

	_closeSubMenus(parentMenu);
	_openSubMenu(parentMenu, parentButton, _resolveContextSubmenu(parentButton._contextMenuItem).items);
}

/**
 * Wyświetla menu kontekstowe z podanymi elementami w miejscu kliknięcia.
 * `submenu` może być tablicą lub selektorem:
 * `{ type: 'single'|'multi', value, defaultValue?, clearable?, items, onChange }`
 * lub `{ type: 'range', value: { min, max }, bounds?, step?, labels?, onChange }`.
 * @param {Array<{icon?, label?, content?, action?, active?, danger?, disabled?, visible?, separator?, submenu?}>} items
 * @param {{x: number, y: number}} pos
 * @param {HTMLElement} [trigger]
 */
function showContextMenu(items, pos, trigger) {
	closeContextMenu();

	const menu = _createContextMenu(items, pos, null);
	menu._trigger = trigger || null;
	_activeContextMenu = menu;
	trigger?.setAttribute('aria-expanded', 'true');

	setTimeout(() => {
		document.addEventListener('click',       _onContextMenuOutsideClick);
		document.addEventListener('contextmenu', _onContextMenuOutsideClick);
		document.addEventListener('keydown',     _onContextMenuKeydown);
	}, 0);
}

function showTriggeredContextMenu(items, trigger) {
	const wasOpen = _activeContextMenu?._trigger === trigger;
	closeAllPopups();
	if (wasOpen) return;

	const rect = trigger.getBoundingClientRect();
	showContextMenu(items, { x: rect.left, y: rect.bottom + 6 }, trigger);
}
