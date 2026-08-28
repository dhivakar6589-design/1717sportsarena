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

document.addEventListener('DOMContentLoaded', () => {
  const dateStrip = document.getElementById('dateStrip');
  const slotGrid = document.getElementById('slotGrid');
  const priceSummary = document.getElementById('priceSummary');
  const totalAmt = document.getElementById('totalAmt');
  const advanceAmt = document.getElementById('advanceAmt');
  const balanceAmt = document.getElementById('balanceAmt');
  const bookingForm = document.getElementById('bookingForm');
  const msg = document.getElementById('bookingMsg');

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
    return document.querySelector('input[name="format"]:checked').value;
  }

  function buildDateStrip() {
    dateStrip.innerHTML = '';
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    days.forEach((d, i) => {
      const iso = formatDateISO(d);
      const chip = document.createElement('div');
      chip.className = 'date-chip' + (i === 0 ? ' selected' : '');
      chip.innerHTML = `<div class="day-num">${d.getDate()}</div><div class="day-name">${dayNames[d.getDay()]}</div>`;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedDate = iso;
        generateSlotGrid();
      });
      dateStrip.appendChild(chip);
    });
    selectedDate = formatDateISO(days[0]);
  }

  async function generateSlotGrid() {
    slotGrid.innerHTML = '<p style="color:var(--gray); font-size:13px;">Loading availability...</p>';
    selectedSlots = [];
    updatePriceSummary();
    if (!selectedDate) return;

    const sport = getSelectedSport();
    let bookedSlots = [];
    let blockedSlots = [];
    let pastSlots = [];

    try {
      const res = await fetch(`${API_BASE}/bookings/slots?date=${selectedDate}&sport=${sport}`);
      const data = await res.json();
      bookedSlots = data.bookedSlots || [];
      blockedSlots = data.blockedSlots || [];
      pastSlots = data.pastSlots || [];
    } catch (err) {
      slotGrid.innerHTML = '<p style="color:#ff5c5c; font-size:13px;">Could not load slots. Is the server running?</p>';
      return;
    }

    const now = new Date();
    const isToday = selectedDate === formatDateISO(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    slotGrid.innerHTML = '';
    for (let h = 6; h < 22; h++) {
      const start = h.toString().padStart(2, '0') + ':00';
      const end = (h + 1).toString().padStart(2, '0') + ':00';
      const label = `${start} - ${end}`;
      const price = getPriceForHour(h);
      const isBooked = bookedSlots.includes(label);
      const isBlocked = blockedSlots.includes(label);
      const isPast = (isToday && h * 60 <= nowMinutes) || pastSlots.includes(label);
      const disabled = isBooked || isBlocked || isPast;

      const chip = document.createElement('div');
      chip.className = 'slot-chip' + (disabled ? ' disabled' : '');
      chip.dataset.label = label;
      chip.innerHTML = `${to12HourLabel(h)}<br><small>₹${price}/hr</small>`;
      if (isBlocked) chip.title = 'Unavailable — turf closed/blocked by host';
      else if (isPast) chip.title = 'This slot has already started';
      else if (isBooked) chip.title = 'Already booked';

      if (!disabled) {
        chip.addEventListener('click', () => {
          if (chip.classList.contains('disabled')) return;
          chip.classList.toggle('selected');
          if (chip.classList.contains('selected')) {
            selectedSlots.push({ label, price });
          } else {
            selectedSlots = selectedSlots.filter(s => s.label !== label);
          }
          updatePriceSummary();
        });
      }
      slotGrid.appendChild(chip);
    }
  }

  function updatePriceSummary() {
    if (selectedSlots.length === 0) {
      priceSummary.style.display = 'none';
      return;
    }
    const total = selectedSlots.reduce((sum, s) => sum + s.price, 0);
    const advance = Math.min(ADVANCE_PER_SLOT * selectedSlots.length, total);
    const balance = total - advance;
    const payBtn = document.getElementById('payBtn');
    const advanceRow = document.getElementById('advanceRow');

    totalAmt.textContent = '₹' + total;
    advanceAmt.textContent = '₹' + advance;
    balanceAmt.textContent = '₹' + balance;
    if (advanceRow) advanceRow.style.display = 'flex';
    if (payBtn) payBtn.textContent = `Pay ₹${advance} Advance & Book`;
    priceSummary.style.display = 'block';
  }

  function toggleFormatGroup() {
    const formatGroup = document.getElementById('formatGroup');
    if (formatGroup) formatGroup.style.display = getSelectedSport() === 'football' ? 'block' : 'none';
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
        chip.classList.remove('selected');
        chip.classList.add('disabled');
        chip.title = 'This slot has already started';
        const label = chip.dataset.label;
        selectedSlots = selectedSlots.filter(s => s.label !== label);
        updatePriceSummary();
      }
    });
  }
  setInterval(refreshPastSlots, 30000);

  buildDateStrip();
  generateSlotGrid();

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const sport = getSelectedSport();
    const format = getSelectedFormat();

    if (!name) { msg.style.color = '#ff5c5c'; msg.textContent = 'Please enter your name.'; return; }
    if (!/^[0-9]{10}$/.test(phone)) { msg.style.color = '#ff5c5c'; msg.textContent = 'Please enter a valid 10-digit phone number.'; return; }
    if (selectedSlots.length === 0) { msg.style.color = '#ff5c5c'; msg.textContent = 'Please select at least one time slot.'; return; }

    const slotsSorted = selectedSlots.map(s => s.label).sort();

    msg.style.color = '#d4af37';
    msg.textContent = 'Creating your booking...';

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
        msg.style.color = '#ff5c5c';
        msg.textContent = data.error || 'Booking failed. Please try again.';
        generateSlotGrid();
        return;
      }

      const bookingId = data.bookingId;
      const { advanceAmount, balanceAmount } = data;

      // ---- Online payment: open the Razorpay advance checkout ----
      msg.style.color = '#2ecc40';
      msg.textContent = `Booking created (ID: ${bookingId}). Opening payment...`;

      try {
        const orderRes = await fetch(`${API_BASE}/payment/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: bookingId, amount: advanceAmount })
        });
        const orderData = await orderRes.json();

        if (!orderRes.ok) {
          msg.style.color = '#ff5c5c';
          msg.textContent = orderData.error || 'Could not start payment. Please try again.';
          generateSlotGrid();
          return;
        }

        if (typeof Razorpay === 'undefined') {
          msg.style.color = '#ff5c5c';
          msg.textContent = 'Payment window could not load (Razorpay blocked). Your slot is NOT booked yet — please try again.';
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
          theme: { color: '#2ecc40' },
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
                alert(`✅ Payment successful!\nAdvance of ₹${advanceAmount} received.\nYour slots are confirmed.\nPay ₹${balanceAmount} at the turf.`);
              } else if (verifyData.conflict) {
                alert(`⚠️ ${verifyData.error}`);
              } else {
                alert(`⚠️ Payment could not be verified: ${verifyData.error || 'unknown error'}. Your slot is NOT confirmed.`);
              }
            } catch (err) {
              alert('⚠️ Could not reach the server to verify payment. Please contact the turf with your booking ID: ' + bookingId);
            }
            bookingForm.reset();
            buildDateStrip();
            generateSlotGrid();
          },
          modal: {
            ondismiss: function () {
              alert('Payment window closed. Your slot was NOT booked — no payment was received. Please book again to confirm your slot.');
              bookingForm.reset();
              buildDateStrip();
              generateSlotGrid();
            }
          }
        };

        const rzp = new Razorpay(options);
        rzp.open();
      } catch (err) {
        msg.style.color = '#ff5c5c';
        msg.textContent = 'Payment window failed to open. Your slot is NOT booked yet — please try again.';
      }
    } catch (err) {
      msg.style.color = '#ff5c5c';
      msg.textContent = 'Could not connect to server. Is it running?';
    }
  });
});

// ---- Booking confirmation card (shown after success) ----
function showConfirmation(details) {
  const el = document.getElementById('bookingConfirm');
  el.innerHTML = `
    <h3>Booking Confirmed</h3>
    <div class="confirm-row"><span>Booking ID</span><span>${details.bookingId}</span></div>
    <div class="confirm-row"><span>Date</span><span>${details.date}</span></div>
    <div class="confirm-row"><span>Sport</span><span>${details.sport.toUpperCase()} (${details.format})</span></div>
    <div class="confirm-row"><span>Slots</span><span>${details.slots.map(to12HourDisplay).join(', ')}</span></div>
    <div class="confirm-row"><span>Payment Mode</span><span>Online (Advance Paid)</span></div>
    <div class="confirm-row"><span>Advance Paid</span><span>₹${details.advanceAmount}</span></div>
    <div class="confirm-row"><span>Balance at Turf</span><span>₹${details.balanceAmount}</span></div>
    <p class="confirm-note">📸 Please take a screenshot of this confirmation for your records and show it at the turf.</p>
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

  async function loadMyBookings() {
    const phone = lookupPhone.value.trim();
    if (!/^[0-9]{10}$/.test(phone)) {
      lookupMsg.style.color = '#ff5c5c';
      lookupMsg.textContent = 'Please enter a valid 10-digit phone number.';
      return;
    }
    lookupMsg.style.color = '#d4af37';
    lookupMsg.textContent = 'Looking up your bookings...';
    try {
      const res = await fetch(`${API_BASE}/bookings/lookup?phone=${phone}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      lookupMsg.textContent = '';
      myBookingsList.innerHTML = '';
      if (!data.bookings.length) {
        myBookingsList.innerHTML = '<p style="color:var(--gray);font-size:13px;">No bookings found for this number.</p>';
        return;
      }
      data.bookings.forEach(b => {
        const card = document.createElement('div');
        const statusClass = b.status === 'cancelled' ? 'cancelled' : (b.status === 'advance-paid' || b.status === 'completed' ? 'confirmed' : 'pending');
        const statusLabel = b.status === 'pending-payment' ? 'Payment Pending' : b.status.toUpperCase();
        const cancellable = (b.status === 'pending-payment' || b.status === 'advance-paid') && b.date >= formatDateISO(new Date());
        card.className = 'my-booking-card ' + statusClass;
        card.innerHTML = `
          <div class="mb-top">
            <span class="mb-id">${b.id}</span>
            <span class="mb-status">${statusLabel}</span>
          </div>
          <div class="mb-slots">${b.slots.map(to12HourDisplay).join(', ')}</div>
          <div class="mb-top">
            <span class="mb-date">${b.date} • ${b.sport.toUpperCase()} (${b.format}) • ${b.paymentMode === 'cash' ? '💵 Cash at turf' : '💳 Online'}</span>
            <span class="mb-date">${b.paymentMode === 'cash' ? `₹${b.balanceAmount} due at turf` : `₹${b.advanceAmount} paid`}</span>
          </div>
          ${cancellable ? `<div style="margin-top:12px;"><button class="btn-cancel-booking" onclick="cancelMyBooking('${b.id}')">Cancel this booking</button></div>` : ''}
        `;
        myBookingsList.appendChild(card);
      });
    } catch (err) {
      lookupMsg.style.color = '#ff5c5c';
      lookupMsg.textContent = err.message || 'Could not load bookings. Is the server running?';
    }
  }

  window.cancelMyBooking = async function (id) {
    const phone = lookupPhone.value.trim();
    if (!confirm('Cancel this booking? The advance payment is non-refundable and will NOT be returned.')) return;
    try {
      const res = await fetch(`${API_BASE}/bookings/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel booking');
      alert(data.message);
      loadMyBookings();
    } catch (err) {
      alert(err.message || 'Could not cancel booking. Please try again.');
    }
  };

  lookupBtn.addEventListener('click', loadMyBookings);
  lookupPhone.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMyBookings(); });
});
