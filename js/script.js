// Shared HTML escaper. Every value that originates from the database (customer
// names, review text, news titles) must go through this before being injected
// with innerHTML.
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* ---------- Inline SVG helpers ----------
   Kept as literal paths rather than <use> references so these render even on
   pages that do not include the icon sprite in index.html. */
const ICON = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16 9.4"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.2M12 16.4h.01"/></svg>',
  pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6.8v5.4l3.4 2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11.2v5M12 7.9h.01"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 13.2h4.6l1.4 2.6h6l1.4-2.6H21"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.6" cy="10" r="1.7"/><path d="m4 17.4 4.9-4.9 4.4 4.4 2.4-2.4 4.3 4.3"/></svg>'
};

function skeletonCards(count) {
  return Array.from({ length: count }, () => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-line" style="width:40%"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line"></div>
    </div>`).join('');
}

function emptyState(icon, title, text, isError) {
  return `
    <div class="empty-state${isError ? ' is-error' : ''}" style="grid-column:1/-1">
      ${icon}
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(text)}</span>
    </div>`;
}

// Transient status message. Replaces window.alert() so success and failure
// states stay inside the page and do not interrupt the payment flow.
function showToast(kind, title, message, timeout) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const icon = ICON[kind] || ICON.info;

  const toast = document.createElement('div');
  toast.className = 'toast' + (kind ? ` is-${kind}` : '');
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    ${icon}
    <span><strong>${escapeHTML(title)}</strong>${message ? escapeHTML(message) : ''}</span>`;
  stack.appendChild(toast);

  const life = timeout == null ? (kind === 'error' ? 8000 : 5000) : timeout;
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 260);
  }, life);
}

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Mobile navigation ---------- */
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.querySelector('.navbar nav');

  function setMenu(open) {
    if (!hamburger || !mobileNav) return;
    mobileNav.classList.toggle('open', open);
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  }

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      setMenu(!mobileNav.classList.contains('open'));
    });
    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => setMenu(false));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(false);
    });
  }

  /* ---------- Navbar border once the page scrolls ---------- */
  const siteNav = document.getElementById('siteNav');
  if (siteNav) {
    const onScroll = () => siteNav.classList.toggle('is-stuck', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Reviews ---------- */
  const reviewForm = document.getElementById('reviewForm');
  const reviewsList = document.getElementById('reviewsList');

  function starRow(rating) {
    const filled = Array.from({ length: 5 }, (_, i) =>
      `<svg aria-hidden="true"${i < rating ? '' : ' style="opacity:.2"'}><use href="#i-star"/></svg>`
    ).join('');
    return `<span class="review-stars" role="img" aria-label="${rating} out of 5">${filled}</span>`;
  }

  async function renderReviews() {
    if (!reviewsList) return;
    reviewsList.innerHTML = skeletonCards(3);

    try {
      const res = await fetch(`${API_BASE}/reviews`);
      if (!res.ok) throw new Error('request failed');
      const reviews = await res.json();

      reviewsList.innerHTML = '';
      if (!reviews.length) {
        reviewsList.innerHTML = emptyState(
          ICON.inbox, 'No reviews yet',
          'Be the first to write about a game here.'
        );
        return;
      }

      const frag = document.createDocumentFragment();
      reviews.forEach(r => {
        const item = document.createElement('article');
        item.className = 'review-item';
        item.innerHTML = `
          <strong>${escapeHTML(r.name)}</strong>
          ${starRow(Number(r.rating))}
          <p>${escapeHTML(r.text)}</p>`;
        frag.appendChild(item);
      });
      reviewsList.appendChild(frag);
    } catch (err) {
      reviewsList.innerHTML = emptyState(
        ICON.error, 'Could not load reviews',
        'We could not reach the arena server. Refresh the page to try again.',
        true
      );
    }
  }

  if (reviewForm && reviewsList) {
    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reviewerName').value.trim();
      const rating = document.getElementById('reviewRating').value;
      const text = document.getElementById('reviewText').value.trim();

      if (!name || !rating || !text) return;

      const submitBtn = reviewForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.classList.add('is-busy');

      try {
        const res = await fetch(`${API_BASE}/reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, rating, text })
        });
        if (!res.ok) throw new Error('request failed');
        reviewForm.reset();
        showToast('success', 'Review posted', 'Thanks — it is live on the page now.');
        renderReviews();
      } catch (err) {
        showToast('error', 'Could not post review', 'The arena server did not respond. Please try again.');
      } finally {
        if (submitBtn) submitBtn.classList.remove('is-busy');
      }
    });

    renderReviews();
  }

  /* ---------- Scroll reveal ---------- */
  const revealElements = document.querySelectorAll('.reveal');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealElements.forEach(el => el.classList.add('is-in'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealElements.forEach(el => revealObserver.observe(el));
  }

  /* ---------- Active section in the primary nav ---------- */
  const navLinks = Array.from(document.querySelectorAll('.navbar nav ul a[href^="#"]'));
  const sections = navLinks
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      // Highlight the topmost section currently on screen.
      let active = null;
      for (const section of sections) {
        if (visible.has(section.id)) { active = section.id; break; }
      }
      navLinks.forEach(a => {
        if (a.getAttribute('href') === `#${active}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach(s => spy.observe(s));
  }
});

/* ---------- Public news ---------- */
async function renderPublicNews() {
  const newsList = document.getElementById('newsPublicList');
  if (!newsList) return;

  newsList.innerHTML = skeletonCards(3);

  try {
    const res = await fetch(`${API_BASE}/news`);
    if (!res.ok) throw new Error('request failed');
    const posts = await res.json();

    newsList.innerHTML = '';
    if (!posts.length) {
      newsList.innerHTML = emptyState(
        ICON.image, 'Nothing posted yet',
        'Tournament fixtures and arena updates will appear here.'
      );
      return;
    }

    const frag = document.createDocumentFragment();
    posts.forEach(p => {
      const card = document.createElement('article');
      card.className = 'news-card';

      if (p.imagePath) {
        const img = document.createElement('img');
        const src = ASSET_BASE + p.imagePath;
        img.src = src;
        img.alt = p.title ? `${p.title} — arena photo` : 'Arena photo';
        img.loading = 'lazy';
        // addEventListener instead of an inline onclick= so a crafted filename
        // can never break out of the HTML attribute.
        img.addEventListener('click', () => openLightbox(src));
        card.appendChild(img);
      }

      const content = document.createElement('div');
      content.className = 'news-card-content';

      const title = document.createElement('h3');
      title.textContent = p.title || '';
      content.appendChild(title);

      if (p.description) {
        const desc = document.createElement('p');
        desc.textContent = p.description;
        content.appendChild(desc);
      }

      const dateEl = document.createElement('span');
      dateEl.className = 'news-date';
      const d = new Date(p.createdAt);
      dateEl.textContent = Number.isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      content.appendChild(dateEl);

      card.appendChild(content);
      frag.appendChild(card);
    });
    newsList.appendChild(frag);
  } catch (err) {
    newsList.innerHTML = emptyState(
      ICON.error, 'Could not load news',
      'We could not reach the arena server. Refresh the page to try again.',
      true
    );
  }
}

document.addEventListener('DOMContentLoaded', renderPublicNews);

/* ---------- Lightbox ---------- */
function openLightbox(imgSrc) {
  const overlay = document.getElementById('lightboxOverlay');
  const img = document.getElementById('lightboxImg');
  if (!overlay || !img) return;
  img.src = imgSrc;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  const close = overlay.querySelector('.lightbox-close');
  if (close) close.focus();
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});