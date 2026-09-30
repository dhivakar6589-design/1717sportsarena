// Shared HTML escaper. Every value that originates from the database (customer
// names, review text, news titles) must go through this before being injected
// with innerHTML.
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  const reviewForm = document.getElementById('reviewForm');
  const reviewsList = document.getElementById('reviewsList');

  // Mobile hamburger menu
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.querySelector('.navbar nav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      hamburger.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open);
    });
    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  async function renderReviews() {
    reviewsList.innerHTML = '<p style="color:var(--gray); font-size:13px;">Loading reviews...</p>';
    try {
      const res = await fetch(`${API_BASE}/reviews`);
      const reviews = await res.json();

      reviewsList.innerHTML = '';
      if (reviews.length === 0) {
        reviewsList.innerHTML = '<p style="color:var(--gray); font-size:13px;">No reviews yet. Be the first!</p>';
        return;
      }
      reviews.forEach(r => {
        const stars = '⭐'.repeat(Number(r.rating));
        const item = document.createElement('div');
        item.className = 'review-item';
        item.innerHTML = `
          <strong>${escapeHTML(r.name)}</strong>
          <div class="review-stars">${stars}</div>
          <p>${escapeHTML(r.text)}</p>
        `;
        reviewsList.appendChild(item);
      });
    } catch (err) {
      reviewsList.innerHTML = '<p style="color:#ff5c5c; font-size:13px;">Could not load reviews. Is the server running?</p>';
    }
  }

  reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reviewerName').value.trim();
    const rating = document.getElementById('reviewRating').value;
    const text = document.getElementById('reviewText').value.trim();

    if (!name || !rating || !text) return;

    try {
      await fetch(`${API_BASE}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rating, text })
      });
      reviewForm.reset();
      renderReviews();
    } catch (err) {
      alert('Could not submit review. Is the server running?');
    }
  });

  renderReviews();

  const revealElements = document.querySelectorAll('.reveal');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealElements.forEach(el => revealObserver.observe(el));
});

async function renderPublicNews() {
  const newsList = document.getElementById('newsPublicList');
  if (!newsList) return;

  try {
    const res = await fetch(`${API_BASE}/news`);
    const posts = await res.json();

    if (posts.length === 0) {
      newsList.innerHTML = '<p style="color:var(--gray); text-align:center;">No tournaments or news posted yet. Check back soon!</p>';
      return;
    }

    newsList.innerHTML = '';
    posts.forEach(p => {
      const card = document.createElement('div');
      card.className = 'news-card';

      if (p.imagePath) {
        const img = document.createElement('img');
        const src = ASSET_BASE + p.imagePath;
        img.src = src;
        img.alt = p.title || 'News image';
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
      dateEl.textContent = new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      content.appendChild(dateEl);

      card.appendChild(content);
      newsList.appendChild(card);
    });
  } catch (err) {
    newsList.innerHTML = '<p style="color:#ff5c5c; text-align:center;">Could not load news. Is the server running?</p>';
  }
}

document.addEventListener('DOMContentLoaded', renderPublicNews);

function openLightbox(imgSrc) {
  const overlay = document.getElementById('lightboxOverlay');
  const img = document.getElementById('lightboxImg');
  img.src = imgSrc;
  overlay.classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightboxOverlay').classList.remove('active');
}
