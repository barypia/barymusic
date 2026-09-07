/**
 * i18n system for BaryMusic
 */

const i18n = {
    isInitialized: false,

    async init() {
        if (this.isInitialized) return;

        const initialLng = settings.language || null;

        await i18next
            .use(i18nextHttpBackend)
            .use(i18nextBrowserLanguageDetector)
            .init({
                fallbackLng: 'pl',
                supportedLngs: ['pl', 'en'],
                load: 'languageOnly',
                lng: initialLng,
                debug: false,
                backend: {
                    loadPath: '/locales/{{lng}}/translation.json',
                },
                detection: {
                    order: ['querystring', 'localStorage', 'navigator'],
                    lookupQuerystring: 'lng',
                    lookupLocalStorage: 'i18nextLng',
                    caches: ['localStorage']
                }
            });

        this.isInitialized = true;
        this.translatePage();

        // Sync dropdown values on init
        const currentLng = (i18next.language).split('-')[0];
        if (settings.language !== currentLng) {
            settings.language = currentLng;
            persistSettings();
        }
        document.documentElement.lang = currentLng.split('-')[0];
        ['languageSelect', 'languageSetup'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = currentLng;
            }
        });

        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has('lng')) {
            currentUrl.searchParams.delete('lng');
            history.replaceState(null, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
        }

        // Listen for language changes
        i18next.on('languageChanged', (lng) => {
            document.documentElement.lang = lng.split('-')[0];
            this.translatePage();
            // Update settings if needed
            if (settings.language !== lng) {
                settings.language = lng;
                persistSettings();
            }
            // Sync select elements
            ['languageSelect', 'languageSetup'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.value = lng;
                }
            });
            // Refresh connect subtitle if it was set
            if (typeof _connectSubtitleCallback === 'function') {
                setConnectSubtitle(_connectSubtitleCallback);
            }
            if (typeof updateSongCount === 'function') {
                updateSongCount()
            }
            if (typeof updateSetlistCount === 'function') {
                updateSetlistCount()
            }
        });
    },

    /**
     * Translates all elements with [data-i18n] or [data-i18n-title] attribute
     */
    translatePage() {
        // Translate text content or placeholders
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = i18next.t(key);

            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = translation;
            } else {
                el.innerText = translation;
            }
        });

        // Translate attributes that are not covered by [data-i18n].
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = i18next.t(key);
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria-label');
            el.setAttribute('aria-label', i18next.t(key));
        });
        document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
            const key = el.getAttribute('data-i18n-tooltip');
            const translation = i18next.t(key);
            el.dataset.tooltip = translation;
            el.setAttribute('aria-label', `${el.innerText}: ${translation}`);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = i18next.t(key);
        });
        document.querySelectorAll('[data-i18n-alt]').forEach(el => {
            const key = el.getAttribute('data-i18n-alt');
            el.alt = i18next.t(key);
        });
        document.querySelectorAll('[data-i18n-empty]').forEach(el => {
            const key = el.getAttribute('data-i18n-empty');
            el.dataset.emptyText = i18next.t(key);
        });

        // Re-create lucide icons if they were inside translated elements
        if (window.lucide) {
            window.lucide.createIcons();
        }
    },

    /**
     * Helper to get translation programmatically
     */
    t(key, options) {
        if (typeof i18next === 'undefined' || !this.isInitialized) {
            // Return key as fallback if not initialized yet
            return key;
        }
        return i18next.t(key, options);
    },

    changeLanguage(lng) {
        i18next.changeLanguage(lng);
    }
};

// Expose to window for global access
window.i18n = i18n;
