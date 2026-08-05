const dialog = document.querySelector('#beta-dialog');
const betaTriggers = document.querySelectorAll('[data-beta-trigger]');

betaTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => dialog?.showModal());
});

document.querySelector('.dialog-close')?.addEventListener('click', () => dialog?.close());
document.querySelector('.dialog-ok')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
});

const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const header = document.querySelector('.site-header');
const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 24);
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();
