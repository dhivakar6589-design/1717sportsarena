// ---- Shared helpers (global so the payment flow and My Bookings both use them) ----

// 12-hour AM/PM label for a slot, e.g. hour 14 -> "02:00 PM - 03:00 PM"
function to12HourLabel(h) {
  const fmt = (x) => {
    const h12 = x % 12 || 12;
    const suffix = x < 12 ? 'AM' : 'PM';
    return `${String(h12).padStart(2, '0')}:00 ${suffix}`;
  };
  return `${fmt(h)} - ${fmt(h + 1)}`;
}

// Convert a 24h API slot label like "14:00 - 15:00" to 12-hour display form
function to12HourDisplay(label) {
  const m = /^([0-9]{2}):00 - ([0-9]{2}):00$/.exec(label);
  if (!m) return label;
  return to12HourLabel(Number(m[1]));
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Escape a value before injecting it into innerHTML. Booking rows come from the
// database, so anything customer-supplied must pass through this first.
function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const dateStrip = document.getElementById('dateStrip');
  const slotGrid = document.getElementById('slotGrid');
  const priceSummary = document.getElementById('priceSummary');
  const totalAmt = document.getElementById('totalAmt');
  const advanceAmt = document.getElementById('advanceAmt');
  const balanceAmt = document.getElementById('balanceAmt');
  const bookingForm = document.getElementById('bookingForm');
  const msg = document.getElementById('bookingMsg');
  const slotHint = document.getElementById('slotHint');
  const nameInput = document.getElementById('name');
  const phoneInput = document.getElementById('phone');
  const payBtn = document.getElementById('payBtn');
  const payBtnLabel = payBtn ? payBtn.querySelector('span') : null;
  const advanceRow = document.getElementById('advanceRow');

  const ADVANCE_PER_SLOT = 100;

  let selectedDate = null;
  let selectedSlots = [];

  function getPriceForHour(hour) {
    if (hour >= 6 && hour < 14) return 500;
    if (hour >= 14 && hour < 18) return 750;
    if (hour >= 18 && hour < 22) return 1000;
    return 0;
  }

  function getSelectedSport() {
    return document.querySelector('input[name="sport"]:checked').value;
  }

  function getSelectedFormat() {
    const checked = document.querySelector('input[name="format"]:checked');
    return checked ? checked.value : '';
  }

  // Status line under the submit button. Replaces colour-coded <p> text.
  function setMessage(kind, text) {
    if (!msg) return;
    msg.textContent = text || '';
    msg.classList.remove('is-error', 'is-pending', 'is-success');
    if (kind) msg.classList.add(`is-${kind}`);
  }

  function setFieldError(input, invalid) {
    if (!input) return;
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function skeletonSlots(count) {
    return Array.from({ length: count }, () =>
      '<div class="skeleton skeleton-line" style="height:3.25rem;margin-bottom:0" aria-hidden="true"></div>'
    ).join('');
  }

  function buildDateStrip() {
    dateStrip.innerHTML = '';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    days.forEach((d, i) => {
      const iso = formatDateISO(d);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'date-chip' + (i === 0 ? ' selected' : '');
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(i === 0));
      chip.setAttribute('aria-label', d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }));
      chip.innerHTML = `<span class="day-num">${d.getDate()}</span><span class="day-name">${dayNames[d.getDay()]}</span>`;
      chip.addEventListener('click', () => {
        dateStrip.querySelectorAll('.date-chip').forEach(c => {
          c.classList.remove('selected');
          c.setAttribute('aria-checked', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-checked', 'true');
        selectedDate = iso;
        generateSlotGrid();
      });
      dateStrip.appendChild(chip);
    });
    selectedDate = formatDateISO(days[0]);
  }

  async function generateSlotGrid() {
    selectedSlots = [];
    updatePriceSummary();
    if (!selectedDate) return;

    slotGrid.innerHTML = skeletonSlots(16);
    slotGrid.setAttribute('aria-busy', 'true');

    const sport = getSelectedSport();
    let bookedSlots = [];
    let blockedSlots = [];
    let pastSlots = [];

    try {
      const res = await fetch(`${API_BASE}/bookings/slots?date=${selectedDate}&sport=${sport}`);
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      bookedSlots = data.bookedSlots || [];
      blockedSlots = data.blockedSlots || [];
      pastSlots = data.pastSlots || [];
    } catch (err) {
      slotGrid.removeAttribute('aria-busy');
      slotGrid.innerHTML = '<p style="color:var(--danger);font-size:.875rem;">Could not load availability. Check your connection and try again.</p>';
      return;
    }

    const now = new Date();
    const isToday = selectedDate === formatDateISO(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const frag = document.createDocumentFragment();
    for (let h = 6; h < 22; h++) {
      const start = h.toString().padStart(2, '0') + ':00';
      const end = (h + 1).toString().padStart(2, '0') + ':00';
      const label = `${start} - ${end}`;
      const price = getPriceForHour(h);
      const isBooked = bookedSlots.includes(label);
      const isBlocked = blockedSlots.includes(label);
      const isPast = (isToday && h * 60 <= nowMinutes) || pastSlots.includes(label);
      const disabled = isBooked || isBlocked || isPast;

      const chip = document.createElement('button');
      chip.type = 'button';
      let modifier = '';
      if (isBooked) modifier = ' is-booked';
      else if (isBlocked) modifier = ' is-blocked';
      else if (isPast) modifier = ' is-past';

      chip.className = 'slot-chip' + (disabled ? ' disabled' : '') + modifier;
      chip.dataset.label = label;
      chip.innerHTML = `${to12HourLabel(h)}<small>&#8377;${price}/hr</small>`;

      if (disabled) {
        chip.disabled = true;
        chip.setAttribute('aria-disabled', 'true');
      } else {
        chip.setAttribute('aria-pressed', 'false');
      }

      if (isBlocked) chip.title = 'Unavailable — the host has blocked this slot';
      else if (isPast) chip.title = 'This slot has already started';
      else if (isBooked) chip.title = 'Already booked';
      else chip.title = `Select ${to12HourLabel(h)} for ₹${price}`;

      if (!disabled) {
        chip.addEventListener('click', () => {
          if (chip.classList.contains('disabled')) return;
          chip.classList.toggle('selected');
          const nowSelected = chip.classList.contains('selected');
          chip.setAttribute('aria-pressed', String(nowSelected));
          if (nowSelected) {
            selectedSlots.push({ label, price });
          } else {
            selectedSlots = selectedSlots.filter(s => s.label !== label);
          }
          updatePriceSummary();
        });
      }
      frag.appendChild(chip);
    }

    slotGrid.innerHTML = '';
    slotGrid.appendChild(frag);
    slotGrid.removeAttribute('aria-busy');
  }

  function updatePriceSummary() {
    const empty = selectedSlots.length === 0;
    priceSummary.style.display = empty ? 'none' : 'block';

    if (payBtn) payBtn.disabled = empty;

    if (slotHint) {
      slotHint.textContent = empty
        ? 'No slots selected yet.'
        : `${selectedSlots.length} slot${selectedSlots.length > 1 ? 's' : ''} selected for ${selectedDate}.`;
    }

    if (empty) return;

    const total = selectedSlots.reduce((sum, s) => sum + s.price, 0);
    const advance = Math.min(ADVANCE_PER_SLOT * selectedSlots.length, total);
    const balance = total - advance;

    totalAmt.textContent = '₹' + total.toLocaleString('en-IN');
    advanceAmt.textContent = '₹' + advance.toLocaleString('en-IN');
    balanceAmt.textContent = '₹' + balance.toLocaleString('en-IN');
    if (advanceRow) advanceRow.style.display = 'flex';
    if (payBtnLabel) payBtnLabel.textContent = `Pay ₹${advance} advance & book`;
  }

  function toggleFormatGroup() {
    const formatGroup = document.getElementById('formatGroup');
    if (formatGroup) formatGroup.style.display = getSelectedSport() === 'football' ? 'flex' : 'none';
  }

  document.querySelectorAll('input[name="sport"]').forEach(radio => {
    radio.addEventListener('change', () => {
      toggleFormatGroup();
      generateSlotGrid();
    });
  });
  toggleFormatGroup();

  function refreshPastSlots() {
    if (selectedDate !== formatDateISO(new Date())) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    document.querySelectorAll('#slotGrid .slot-chip').forEach(chip => {
      if (chip.classList.contains('disabled')) return;
      const m = /^([0-9]{2}):00/.exec(chip.dataset.label || '');
      if (!m) return;
      const h = Number(m[1]);
      if (h * 60 <= nowMinutes) {
        const label = chip.dataset.label;
        chip.classList.remove('selected');
        chip.classList.add('disabled', 'is-past');
        chip.disabled = true;
        chip.setAttribute('aria-disabled', 'true');
        chip.title = 'This slot has already started';
        selectedSlots = selectedSlots.filter(s => s.label !== label);
        updatePriceSummary();
      }
    });
  }
  setInterval(refreshPastSlots, 30000);

  buildDateStrip();
  generateSlotGrid();

  // Clear the error state as soon as the customer edits the offending field.
  [nameInput, phoneInput].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      setFieldError(el, false);
      if (msg && msg.classList.contains('is-error')) setMessage(null, '');
    });
  });

  function setBusy(busy) {
    if (!payBtn) return;
    payBtn.classList.toggle('is-busy', busy);
    payBtn.disabled = busy || selectedSlots.length === 0;
  }

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const sport = getSelectedSport();
    const format = getSelectedFormat();

    if (!name) {
      setFieldError(nameInput, true);
      setMessage('error', 'Please enter your name.');
      return;
    }
    if (!/^[0-9]{10}$/.test(phone)) {
      setFieldError(phoneInput, true);
      setMessage('error', 'Please enter a valid 10-digit phone number.');
      return;
    }
    setFieldError(nameInput, false);
    setFieldError(phoneInput, false);

    if (selectedSlots.length === 0) {
      setMessage('error', 'Please select at least one time slot.');
      return;
    }

    const slotsSorted = selectedSlots.map(s => s.label).sort();

    setBusy(true);
    setMessage('pending', 'Creating your booking...');

    let bookingId;
    let advanceAmount;
    let balanceAmount;

    try {
      const res = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, phone, date: selectedDate, sport, format,
          slots: slotsSorted
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage('error', data.error || 'Booking failed. Please try again.');
        generateSlotGrid();
        return;
      }

      bookingId = data.bookingId;
      advanceAmount = data.advanceAmount;
      balanceAmount = data.balanceAmount;

      setMessage('pending', `Booking ${bookingId} created. Opening payment...`);

      const orderRes = await fetch(`${API_BASE}/payment/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: bookingId, amount: advanceAmount })
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok) {
        setMessage('error', orderData.error || 'Could not start payment. Please try again.');
        generateSlotGrid();
        return;
      }

      if (typeof Razorpay === 'undefined') {
        setMessage('error', 'The payment window could not load. Your slot is NOT booked yet, please try again.');
        return;
      }

      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: '1717 Sports Arena',
        description: `Advance for ${sport.toUpperCase()} (${format}) - ${slotsSorted.map(to12HourDisplay).join(', ')}`,
        order_id: orderData.orderId,
        prefill: { name: name, contact: phone },
        theme: { color: '#a9d65e' },
        handler: async function (response) {
          try {
            const verifyRes = await fetch(`${API_BASE}/payment/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                bookingId: bookingId
              })
            });
            const verifyData = await verifyRes.json();

            if (verifyData.success) {
              showConfirmation({ bookingId, name, phone, date: selectedDate, sport, format, slots: slotsSorted, advanceAmount, balanceAmount });
              setMessage('success', `Advance of ₹${advanceAmount} received. Your slots are confirmed.`);
              showToast('success', 'Payment successful', `Advance of ₹${advanceAmount} received. Pay ₹${balanceAmount} at the turf.`);
            } else if (verifyData.conflict) {
              setMessage('error', verifyData.error || 'That slot was taken while you were paying.');
              showToast('error', 'Slot no longer available', verifyData.error || 'Another booking took that slot.');
            } else {
              setMessage('error', 'Payment could not be verified. Your slot is NOT confirmed.');
              showToast('error', 'Payment not verified', verifyData.error || 'Contact the arena with your booking ID.');
            }
          } catch (err) {
            setMessage('error', 'Could not reach the server to verify payment.');
            showToast('error', 'Could not verify payment', 'Contact the arena with your booking ID: ' + bookingId);
          }
          bookingForm.reset();
          buildDateStrip();
          generateSlotGrid();
        },
        modal: {
          ondismiss: function () {
            setMessage('error', 'Payment window closed. No payment was received and the slot is NOT booked.');
            showToast('pending', 'Payment window closed', 'No payment was received. Your slot is not booked.');
            bookingForm.reset();
            buildDateStrip();
            generateSlotGrid();
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.open();
    } catch (err) {
      setMessage('error', 'Could not reach the arena server. Please try again.');
    } finally {
      setBusy(false);
    }
  });
});

// ---- Booking confirmation card (shown after success) ----
function showConfirmation(details) {
  const el = document.getElementById('bookingConfirm');
  if (!el) return;
  el.innerHTML = `
    <h3><svg aria-hidden="true"><use href="#i-check"/></svg>Booking confirmed</h3>
    <div class="confirm-row"><span>Booking ID</span><span>${escapeHTML(details.bookingId)}</span></div>
    <div class="confirm-row"><span>Date</span><span>${escapeHTML(details.date)}</span></div>
    <div class="confirm-row"><span>Sport</span><span>${escapeHTML(details.sport.toUpperCase())} (${escapeHTML(details.format)})</span></div>
    <div class="confirm-row"><span>Slots</span><span>${escapeHTML(details.slots.map(to12HourDisplay).join(', '))}</span></div>
    <div class="confirm-row"><span>Payment mode</span><span>Online (advance paid)</span></div>
    <div class="confirm-row"><span>Advance paid</span><span>₹${details.advanceAmount}</span></div>
    <div class="confirm-row"><span>Balance at turf</span><span>₹${details.balanceAmount}</span></div>
    <p class="confirm-note">Take a screenshot of this confirmation and show it at the turf.</p>
  `;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- My Bookings: look up by phone & self-cancel ----
document.addEventListener('DOMContentLoaded', () => {
  const lookupBtn = document.getElementById('lookupBtn');
  const lookupPhone = document.getElementById('lookupPhone');
  const lookupMsg = document.getElementById('lookupMsg');
  const myBookingsList = document.getElementById('myBookingsList');

  function setLookupMessage(kind, text) {
    if (!lookupMsg) return;
    lookupMsg.textContent = text || '';
    lookupMsg.classList.remove('is-error', 'is-pending', 'is-success');
    if (kind) lookupMsg.classList.add(`is-${kind}`);
  }

  function skeletonBookings(count) {
    return Array.from({ length: count }, () => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton skeleton-line" style="width:30%"></div>
        <div class="skeleton skeleton-line" style="margin-top:1rem"></div>
        <div class="skeleton skeleton-line"></div>
      </div>`).join('');
  }

  function emptyBookings(title, text) {
    return `
      <div class="empty-state" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 13.2h4.6l1.4 2.6h6l1.4-2.6H21"/></svg>
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(text)}</span>
      </div>`;
  }

  async function loadMyBookings() {
    const phone = lookupPhone.value.trim();
    if (!/^[0-9]{10}$/.test(phone)) {
      lookupPhone.setAttribute('aria-invalid', 'true');
      setLookupMessage('error', 'Please enter a valid 10-digit phone number.');
      return;
    }
    lookupPhone.removeAttribute('aria-invalid');
    setLookupMessage('pending', 'Looking up your bookings...');
    myBookingsList.innerHTML = skeletonBookings(2);

    try {
      const res = await fetch(`${API_BASE}/bookings/lookup?phone=${phone}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');

      setLookupMessage(null, '');
      myBookingsList.innerHTML = '';
      if (!data.bookings.length) {
        myBookingsList.innerHTML = emptyBookings('No bookings on this number', 'Check the number you booked with, or book a slot first.');
        return;
      }

      const frag = document.createDocumentFragment();
      data.bookings.forEach(b => {
        const statusClass = b.status === 'cancelled' ? 'cancelled'
          : (b.status === 'advance-paid' || b.status === 'completed' ? 'confirmed' : 'pending');
        const statusLabel = b.status === 'pending-payment' ? 'Payment pending' : b.status.replace(/-/g, ' ');
        const cancellable = (b.status === 'pending-payment' || b.status === 'advance-paid')
          && b.date >= formatDateISO(new Date());

        const card = document.createElement('article');
        card.className = 'my-booking-card ' + statusClass;
        card.innerHTML = `
          <div class="mb-top">
            <span class="mb-id">${escapeHTML(b.id)}</span>
            <span class="mb-status">${escapeHTML(statusLabel)}</span>
          </div>
          <div class="mb-slots">${escapeHTML(b.slots.map(to12HourDisplay).join(', '))}</div>
          <div class="mb-top">
            <span class="mb-date">${escapeHTML(b.date)} &middot; ${escapeHTML(b.sport.toUpperCase())} (${escapeHTML(b.format)}) &middot; ${b.paymentMode === 'cash' ? 'Cash at turf' : 'Paid online'}</span>
            <span class="mb-date">${b.paymentMode === 'cash' ? `₹${b.balanceAmount} due at turf` : `₹${b.advanceAmount} paid`}</span>
          </div>
          ${cancellable ? `<div class="mb-actions"><button type="button" class="btn-cancel-booking" data-booking-id="${escapeHTML(b.id)}">Cancel this booking</button></div>` : ''}
        `;
        frag.appendChild(card);
      });
      myBookingsList.appendChild(frag);

      // Event delegation keeps the inline-handler attribute out of the markup.
      myBookingsList.querySelectorAll('[data-booking-id]').forEach(btn => {
        btn.addEventListener('click', () => cancelMyBooking(btn.dataset.bookingId));
      });
    } catch (err) {
      myBookingsList.innerHTML = '';
      setLookupMessage('error', err.message || 'Could not load your bookings. Please try again.');
    }
  }

  window.cancelMyBooking = async function (id) {
    const phone = lookupPhone.value.trim();
    if (!confirm('Cancel this booking? The advance payment is non-refundable and will NOT be returned.')) return;

    try {
      const res = await fetch(`${API_BASE}/bookings/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel booking');
      showToast('success', 'Booking cancelled', data.message || 'The slot has been released.');
      loadMyBookings();
    } catch (err) {
      showToast('error', 'Could not cancel booking', err.message || 'Please try again.');
    }
  };

  lookupPhone.addEventListener('input', () => {
    lookupPhone.removeAttribute('aria-invalid');
    if (lookupMsg.classList.contains('is-error')) setLookupMessage(null, '');
  });

  lookupBtn.addEventListener('click', loadMyBookings);
  lookupPhone.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMyBookings(); });
});