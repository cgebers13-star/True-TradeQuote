(function () {
  const form = document.getElementById('estimateForm');
  const formError = document.getElementById('formError');
  const loadingState = document.getElementById('loadingState');
  const resultsSection = document.getElementById('resultsSection');
  const submitBtn = document.getElementById('submitBtn');

  const safetyWarningEl = document.getElementById('safetyWarning');
  const demoDataBanner = document.getElementById('demoDataBanner');
  const tradeBadge = document.getElementById('tradeBadge');
  const costRange = document.getElementById('costRange');
  const costNote = document.getElementById('costNote');
  const matchesGrid = document.getElementById('matchesGrid');
  const noMatches = document.getElementById('noMatches');
  const startOverLink = document.getElementById('startOverLink');

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatMoney(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '?';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function starString(rating) {
    if (typeof rating !== 'number') return '';
    const full = Math.round(rating);
    return '★'.repeat(Math.max(0, Math.min(5, full))) + '☆'.repeat(Math.max(0, 5 - full));
  }

  function renderMatches(matches) {
    matchesGrid.innerHTML = '';
    if (!matches || matches.length === 0) {
      noMatches.hidden = false;
      return;
    }
    noMatches.hidden = true;

    matches.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'match-card';

      const distance =
        typeof m.distance_miles === 'number' ? `${m.distance_miles} mi away` : '';
      const reviews = m.review_count ? `(${m.review_count} reviews)` : '';

      let actionsHtml = '';
      if (m.phone) {
        actionsHtml += `<a class="primary" href="tel:${escapeHtml(m.phone.replace(/[^\d+]/g, ''))}">Call</a>`;
      }
      if (m.website) {
        actionsHtml += `<a href="${escapeHtml(m.website)}" target="_blank" rel="noopener noreferrer">Website</a>`;
      }
      if (!m.phone && !m.website) {
        actionsHtml = `<span style="font-size:12.5px;color:var(--text-muted);">Contact info not available</span>`;
      }

      card.innerHTML = `
        <span class="match-rank">${i + 1}</span>
        <h3>${escapeHtml(m.name || 'Local pro')}</h3>
        <div class="match-rating">
          <span class="stars">${starString(m.rating)}</span> ${m.rating ?? ''} ${reviews}
        </div>
        <div class="match-meta">${escapeHtml(distance)}${m.phone ? ' &middot; ' + escapeHtml(m.phone) : ''}</div>
        ${m.specialty_note ? `<div class="match-specialty">${escapeHtml(m.specialty_note)}</div>` : ''}
        <div class="match-actions">${actionsHtml}</div>
      `;
      matchesGrid.appendChild(card);
    });
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearError() {
    formError.hidden = true;
    formError.textContent = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    clearError();

    const job = document.getElementById('jobInput').value.trim();
    const location = document.getElementById('locationInput').value.trim();
    const urgencyInput = form.querySelector('input[name="urgency"]:checked');
    const urgency = urgencyInput ? urgencyInput.value : 'flexible';

    if (!job || !location || !urgencyInput) {
      showError('Please fill in all three fields so we can get you an accurate estimate.');
      return;
    }

    form.hidden = true;
    loadingState.hidden = false;
    resultsSection.hidden = true;
    submitBtn.disabled = true;

    try {
      const resp = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job, location, urgency })
      });
      const data = await resp.json();

      loadingState.hidden = true;

      if (!resp.ok) {
        form.hidden = false;
        showError(data.error || 'Something went wrong getting your estimate. Please try again.');
        return;
      }

      // Safety warning
      if (data.safetyWarning) {
        safetyWarningEl.textContent = data.safetyWarning;
        safetyWarningEl.hidden = false;
      } else {
        safetyWarningEl.hidden = true;
      }

      // Demo-data disclosure
      demoDataBanner.hidden = !(data.matchMeta && data.matchMeta.dataSource === 'demo');

      // Trade + estimate
      tradeBadge.textContent = data.tradeCategory || 'Home Service';
      const low = data.costEstimate ? data.costEstimate.low : null;
      const high = data.costEstimate ? data.costEstimate.high : null;
      costRange.textContent =
        low != null && high != null ? `${formatMoney(low)} – ${formatMoney(high)}` : 'Estimate unavailable';
      costNote.textContent = (data.costEstimate && data.costEstimate.note) || '';

      renderMatches(data.matches);

      resultsSection.hidden = false;
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      loadingState.hidden = true;
      form.hidden = false;
      showError('Could not reach the server. Please check your connection and try again.');
    } finally {
      submitBtn.disabled = false;
    }
  }

  function startOver(e) {
    if (e) e.preventDefault();
    resultsSection.hidden = true;
    form.hidden = false;
    form.reset();
    clearError();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('submit', handleSubmit);
  startOverLink.addEventListener('click', startOver);
})();
