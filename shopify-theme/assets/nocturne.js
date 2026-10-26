/* APOLOGEA · NOCTURNE — Theme-Skript (ohne Abhängigkeiten) */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOff = () => reduceMotion || document.body.classList.contains('no-motion');

  /* Reveal beim Scrollen ------------------------------------------------- */
  function initReveal(root = document) {
    const items = root.querySelectorAll('.reveal, .reveal-fade');
    if (!items.length) return;
    if (motionOff() || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    root.querySelectorAll('.reveal--stagger').forEach((group) => {
      [...group.children].forEach((child, i) => {
        child.classList.add('reveal');
        child.style.setProperty('--reveal-delay', `${Math.min(i, 8) * 90}ms`);
      });
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    root.querySelectorAll('.reveal, .reveal-fade').forEach((el) => io.observe(el));
  }

  /* Header-Zustand beim Scrollen ----------------------------------------- */
  function initHeader() {
    const header = document.querySelector('.header-wrapper');
    if (!header) return;
    const update = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /* Menü-Drawer ----------------------------------------------------------- */
  function initDrawer() {
    document.addEventListener('click', (e) => {
      const opener = e.target.closest('[data-drawer-open]');
      const closer = e.target.closest('[data-drawer-close]');
      if (opener) {
        const drawer = document.getElementById(opener.dataset.drawerOpen);
        if (!drawer) return;
        drawer.classList.add('is-open');
        drawer.setAttribute('aria-hidden', 'false');
        opener.setAttribute('aria-expanded', 'true');
        document.body.classList.add('drawer-open');
        drawer.querySelector('[data-drawer-close]')?.focus();
        drawer._opener = opener;
      } else if (closer) {
        closeDrawer(closer.closest('.drawer'));
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.drawer.is-open').forEach(closeDrawer);
    });
  }
  function closeDrawer(drawer) {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    if (drawer._opener) {
      drawer._opener.setAttribute('aria-expanded', 'false');
      drawer._opener.focus();
    }
  }

  /* Mengenfeld ------------------------------------------------------------ */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qty]');
    if (!btn) return;
    const input = btn.parentElement.querySelector('input');
    const step = btn.dataset.qty === 'plus' ? 1 : -1;
    const min = Number(input.min || 0);
    input.value = Math.max(min, Number(input.value || 0) + step);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* Variantenauswahl ------------------------------------------------------ */
  class VariantPicker {
    constructor(form) {
      this.form = form;
      const data = form.querySelector('script[data-variants]');
      if (!data) return;
      this.variants = JSON.parse(data.textContent);
      this.idInput = form.querySelector('input[name="id"]');
      this.submit = form.querySelector('[type="submit"]');
      this.section = form.closest('[data-section]');
      form.addEventListener('change', (e) => {
        if (e.target.closest('.variant-picker')) this.update();
      });
    }

    selectedOptions() {
      return [...this.form.querySelectorAll('.variant-picker')].map(
        (fs) => fs.querySelector('input:checked')?.value
      );
    }

    update() {
      const opts = this.selectedOptions();
      const variant = this.variants.find((v) => v.options.every((o, i) => o === opts[i]));
      this.markAvailability(opts);
      if (!variant) {
        this.setButton(false, this.submit.dataset.unavailable);
        return;
      }
      this.idInput.value = variant.id;
      this.setButton(variant.available, variant.available ? this.submit.dataset.add : this.submit.dataset.soldout);
      this.updatePrice(variant);
      this.updateMedia(variant);
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
    }

    markAvailability(opts) {
      this.form.querySelectorAll('.variant-picker').forEach((fs, idx) => {
        fs.querySelectorAll('input').forEach((input) => {
          const test = [...opts];
          test[idx] = input.value;
          const ok = this.variants.some((v) => v.available && v.options.every((o, i) => o === test[i] || (i !== idx && !test[i])));
          input.classList.toggle('is-unavailable', !ok);
        });
      });
    }

    setButton(enabled, label) {
      this.submit.disabled = !enabled;
      const span = this.submit.querySelector('span');
      if (span && label) span.textContent = label;
    }

    updatePrice(variant) {
      const el = this.section?.querySelector('[data-price]');
      if (!el) return;
      const fmt = (cents) => new Intl.NumberFormat(document.documentElement.lang || 'de', {
        style: 'currency', currency: el.dataset.currency || 'EUR'
      }).format(cents / 100);
      const sale = variant.compare_at_price && variant.compare_at_price > variant.price;
      el.classList.toggle('price--sale', !!sale);
      el.innerHTML = (sale ? `<s>${fmt(variant.compare_at_price)}</s>` : '') +
        `<span class="price__current">${fmt(variant.price)}</span>`;
    }

    updateMedia(variant) {
      if (!variant.featured_media) return;
      const target = this.section?.querySelector(`[data-media-id="${variant.featured_media.id}"]`);
      if (!target) return;
      const gallery = target.parentElement;
      if (window.matchMedia('(max-width: 989px)').matches) {
        gallery.scrollTo({ left: target.offsetLeft - gallery.offsetLeft, behavior: motionOff() ? 'auto' : 'smooth' });
      } else {
        target.scrollIntoView({ behavior: motionOff() ? 'auto' : 'smooth', block: 'nearest' });
      }
    }
  }

  /* Sortierung in Collections ------------------------------------------- */
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-sort]');
    if (!sel) return;
    const url = new URL(window.location.href);
    url.searchParams.set('sort_by', sel.value);
    url.searchParams.delete('page');
    window.location.href = url.toString();
  });

  /* Start ----------------------------------------------------------------- */
  function init(root = document) {
    initReveal(root);
    root.querySelectorAll('form[data-product-form]').forEach((f) => new VariantPicker(f));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initDrawer();
    init();
  });

  // Theme-Editor: neu geladene Abschnitte initialisieren
  document.addEventListener('shopify:section:load', (e) => init(e.target));
})();
