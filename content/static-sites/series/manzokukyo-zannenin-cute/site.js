const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.site-menu');
function setMenu(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('is-open', open);
  menuButton.querySelector('span').textContent = open ? 'とじる' : 'メニュー';
}
menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') { setMenu(false); menuButton.focus(); }
});
document.addEventListener('click', event => { if (!event.target.closest('.side-header')) setMenu(false); });

const browser = document.querySelector('[data-cast-browser]');
const tabs = [...browser.querySelectorAll('[data-tab]')];
const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
let selected = 0;
function selectCast(index, focus = false) {
  selected = (index + tabs.length) % tabs.length;
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(i === selected));
    tab.tabIndex = i === selected ? 0 : -1;
    panels[i].hidden = i !== selected;
  });
  browser.querySelector('.cast-count').textContent = tabs[selected].querySelector('strong').textContent;
  if (focus) tabs[selected].focus({ preventScroll: true });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectCast(index));
  tab.addEventListener('keydown', event => {
    const indices = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: tabs.length - 1 };
    if (Object.hasOwn(indices, event.key)) { event.preventDefault(); selectCast(indices[event.key], true); }
  });
});
browser.querySelector('[data-prev]').addEventListener('click', () => selectCast(selected - 1));
browser.querySelector('[data-next]').addEventListener('click', () => selectCast(selected + 1));
const stage = browser.querySelector('.cast-stage');
let touchStart;
stage.addEventListener('touchstart', event => {
  if (event.touches.length === 1) touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
stage.addEventListener('touchend', event => {
  if (!touchStart) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) selectCast(selected + (dx < 0 ? 1 : -1));
  touchStart = null;
}, { passive: true });
stage.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
