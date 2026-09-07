window.addEventListener('i18nReady', fillLicenses);

function fillLicenses() {
  const barymusicLicense = document.getElementById('license_barymusic');
  const lucideLicense = document.getElementById('license_lucide');
  const tailwindLicense = document.getElementById('license_tailwind');
  const i18nextLicense = document.getElementById('license_i18next');
  const notoSansLicense = document.getElementById('license_noto_sans');
  const sansCodeLicense = document.getElementById('license_sans_code');


  fetch('js/core/licenses/barymusic.txt')
    .then(r => r.text())
    .then(text => barymusicLicense.textContent = text);

  fetch('js/core/licenses/lucide.txt')
    .then(r => r.text())
    .then(text => lucideLicense.textContent = text);

  fetch('js/core/licenses/tailwind.txt')
    .then(r => r.text())
    .then(text => tailwindLicense.textContent = text);

  fetch('js/core/licenses/i18next.txt')
    .then(r => r.text())
    .then(text => i18nextLicense.textContent = text);

  fetch('js/core/licenses/fonts.txt')
    .then(r => r.text())
    .then(text => {
      notoSansLicense.textContent = text;
      sansCodeLicense.textContent = text;
    });
}
