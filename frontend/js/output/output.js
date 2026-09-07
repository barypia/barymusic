/* ==================== WIDOK OUTPUT ==================== */

const outputStyles = {
	padding: {
		left: 3,
		right: 3,
		top: 3,
		bottom: 3,
	},
	display: {
		display: 'flex',
		flexDirection: 'column',
		width: '100%',
		height: '100%',
		padding: '0',
		position: 'relative',
		boxSizing: 'border-box',
		overflow: 'hidden',
		background: 'transparent',
		whiteSpace: 'nowrap',
		overflowWrap: 'normal',
		wordBreak: 'normal',
		fontFamily: '',
		fontWeight: '',
		lineHeight: '',
		letterSpacing: '',
		textAlign: '',
		justifyContent: 'center',
		color: '',
	},
	measure: {
		position: 'fixed',
		visibility: 'hidden',
		pointerEvents: 'none',
		left: '-10000px',
		top: '0',
		display: 'block',
		boxSizing: 'border-box',
		height: 'auto',
		padding: '0',
		overflow: 'visible',
	},
};

function applyDisplaySettings(displaySettings) {
	const display = document.getElementById('display');
	const contentArea = document.getElementById('content-area');
	if (!display || !contentArea) return;

	Object.assign(outputStyles.padding, {
		left: displaySettings.leftPadding,
		right: displaySettings.rightPadding,
		top: displaySettings.topPadding,
		bottom: displaySettings.bottomPadding,
	});

	Object.assign(outputStyles.display, {
		fontFamily: displaySettings.fontFamily,
		fontWeight: displaySettings.fontWeight,
		lineHeight: displaySettings.lineHeight,
		letterSpacing: `${displaySettings.letterSpacing}px`,
		textAlign: displaySettings.textAlign,
		justifyContent: displaySettings.justifyContent || 'center',
		color: displaySettings.color,
		textShadow: displaySettings.textShadow,
	});
	Object.assign(display.style, outputStyles.display);
	contentArea.style.background = displaySettings.background;
	autoResizeFont(display, displaySettings);
}

function stripChords(text) {
    if (!text) return '';
    return text.replace(/\[([A-GHa-gh][♯♭]?(?:m|maj|dim|aug|sus|add)?[0-9]*)\]/g, '');
}

function updateDisplay(content, repeat) {
	requestAnimationFrame(() => {
		const display = document.getElementById('display');

		if (!display) {
			console.error('Element #display nie został znaleziony');
			return;
		}

		const normalized = stripChords(content)
			.replace(/<p>/gi, '')
			.replace(/<\/p>/gi, '\n')
			.replace(/<br\s*\/?>/gi, '\n')
			.trim();

		const textNode = document.createTextNode(normalized);
		const tmp = document.createElement('div');
		tmp.appendChild(textNode);
		const escaped = tmp.innerHTML;

		let cleanContent = escaped
			.replace(/\n+/g, '<br>');

		cleanContent = cleanContent.replace(/<br\s*\/?>$/i, '');

		display.classList.add('fade-out');

		setTimeout(() => {
			// Dodaj nawias otwarcia i x2 na końcu
			const repeatPrefix = repeat && repeat > 1 ? `<span class="output-repeat-inline">[</span>` : '';
			const repeatSuffix = repeat && repeat > 1 ? `<span class="output-repeat-inline">] x${repeat}</span>` : '';
			display.innerHTML = `<span class="output-content">${repeatPrefix}${cleanContent}${repeatSuffix}</span>`;

			// Zastosuj ustawienia i wymuś układ przy każdej aktualizacji treści
			applyDisplaySettings(settings.display);
			
			display.classList.remove('fade-out');
			display.classList.add('fade-in');

			setTimeout(() => {
				display.classList.remove('fade-in');
			}, 300);

		}, 300);
	});
}

function clearDisplay() {
    requestAnimationFrame(() => {
        const display = document.getElementById('display');

        if (!display) {
            console.error('Element #display nie został znaleziony');
            return;
        }

        display.classList.add('fade-out');

        setTimeout(() => {
            display.innerHTML = '';

            display.classList.remove('fade-out');
            display.classList.add('fade-in');

            setTimeout(() => {
                display.classList.remove('fade-in');
            }, 300);

        }, 300);
    });
}

function autoResizeFont(displayElement, displaySettings) {
    const el = displayElement || document.getElementById('display');
    if (!el) {
        console.warn('autoResizeFont: brak elementu display');
        return;
    }

    // Wykonujemy pomiar synchronicznie. Dzięki temu font jest gotowy przed
    // uruchomieniem animacji pojawiania się tekstu.
    const toPercent = (value) => Math.max(0, Math.min(100, Number(value) || 0));
    const left = toPercent(displaySettings?.leftPadding ?? outputStyles.padding.left);
    const right = toPercent(displaySettings?.rightPadding ?? outputStyles.padding.right);
    const top = toPercent(displaySettings?.topPadding ?? outputStyles.padding.top);
    const bottom = toPercent(displaySettings?.bottomPadding ?? outputStyles.padding.bottom);

    const containerWidth = el.clientWidth;
    const containerHeight = el.clientHeight;
    const paddingLeft = containerWidth * left / 100;
    const paddingRight = containerWidth * right / 100;
    const paddingTop = containerHeight * top / 100;
    const paddingBottom = containerHeight * bottom / 100;
    const availableWidth = containerWidth - paddingLeft - paddingRight;
    const availableHeight = containerHeight - paddingTop - paddingBottom;

    if (availableWidth <= 0 || availableHeight <= 0 || !el.textContent.trim()) {
        return;
    }

        // Marginesy są granicami dla tekstu, a nie klasycznym CSS paddingiem,
        // który przesuwałby środek dostępnego obszaru.
        el.style.padding = '0';

        // #display jest kontenerem flex, który może ścisnąć anonimowy element
        // tekstowy. Mierzymy więc kopię poza flexem, aby otrzymać rzeczywisty
        // rozmiar tekstu, a nie rozmiar przyciętego kontenera.
        const styles = getComputedStyle(el);
        const measure = document.createElement('div');
        Object.assign(measure.style, {
            ...outputStyles.display,
            ...outputStyles.measure,
            width: 'max-content',
            maxWidth: 'none',
            fontFamily: styles.fontFamily,
            fontWeight: styles.fontWeight,
            fontStyle: styles.fontStyle,
            lineHeight: el.style.lineHeight || styles.lineHeight,
            letterSpacing: el.style.letterSpacing || styles.letterSpacing,
            whiteSpace: styles.whiteSpace,
            overflowWrap: styles.overflowWrap,
            wordBreak: styles.wordBreak,
        });
        measure.innerHTML = el.innerHTML;
        const measuredContent = measure.querySelector('.output-content');
        if (measuredContent) {
            Object.assign(measuredContent.style, {
                position: 'static',
                display: 'block',
                left: 'auto',
                top: 'auto',
                width: 'max-content',
            });
        }
        measure.querySelectorAll('br').forEach((br) => {
            br.style.display = 'block';
            br.style.margin = '0.3em 0';
            br.style.content = '""';
        });
        document.body.appendChild(measure);

        const fits = (fontSize) => {
            measure.style.fontSize = `${fontSize}px`;
            return measure.scrollWidth <= Math.floor(availableWidth)
                && measure.scrollHeight <= Math.floor(availableHeight);
        };

        // Binary search finds the largest size that fits the visible text area.
        let minimum = 1;
        let maximum = Math.max(availableWidth, availableHeight);
        while (maximum - minimum > 0.1) {
            const candidate = (minimum + maximum) / 2;
            if (fits(candidate)) {
                minimum = candidate;
            } else {
                maximum = candidate;
            }
        }

        el.style.fontSize = `${minimum.toFixed(1)}px`;
        measure.style.fontSize = `${minimum.toFixed(1)}px`;

        const content = el.querySelector('.output-content');
        if (content) {
            const textWidth = measure.scrollWidth;
            const textHeight = measure.scrollHeight;
            const minX = paddingLeft;
            const maxX = Math.max(minX, containerWidth - paddingRight - textWidth);
            const minY = paddingTop;
            const maxY = Math.max(minY, containerHeight - paddingBottom - textHeight);
            const horizontalAlignment = styles.textAlign;
            const verticalAlignment = displaySettings?.justifyContent
                || outputStyles.display.justifyContent
                || 'center';
            const naturalX = horizontalAlignment === 'left'
                ? 0
                : horizontalAlignment === 'right'
                    ? containerWidth - textWidth
                    : (containerWidth - textWidth) / 2;
            const naturalY = verticalAlignment === 'start' || verticalAlignment === 'flex-start'
                ? 0
                : verticalAlignment === 'end' || verticalAlignment === 'flex-end'
                    ? containerHeight - textHeight
                    : (containerHeight - textHeight) / 2;
            const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

            Object.assign(content.style, {
                position: 'absolute',
                display: 'block',
                left: `${clamp(naturalX, minX, maxX)}px`,
                top: `${clamp(naturalY, minY, maxY)}px`,
                width: `${textWidth}px`,
                textAlign: horizontalAlignment,
            });
        }
        measure.remove();

}

window.addEventListener('resize', () => autoResizeFont(), { passive: true });
