const firebaseConfig={apiKey:"AIzaSyBfhbjD0b8UaISn1QrK6E-Ci5Yr7HcUTzA",authDomain:"sultans-cricket.firebaseapp.com",projectId:"sultans-cricket",storageBucket:"sultans-cricket.firebasestorage.app",messagingSenderId:"975861366304",appId:"1:975861366304:web:6bfef2fc3e3b01d0284645"};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// Enable Persistence for Speed
db.enablePersistence().catch(err => console.warn("Persistence failed:", err.code));

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!match) return 0;
    let h = parseInt(match[1]);
    const m = parseInt(match[2] || 0);
    const ap = (match[3] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    // For manual input without AM/PM, assume PM if < 8
    if (!ap && h < 8) h += 12;
    return h * 60 + m;
}


let allBookings = [];
let selectedSlot = null;
let RATE = 2000; // Default

// Init
document.addEventListener('DOMContentLoaded', () => {
    console.log("Public App initializing...");
    // Set min date to today
    const dt = document.getElementById('matchDate');
    if (dt) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const localDate = `${year}-${month}-${day}`;
        dt.min = localDate;
        dt.value = localDate;
        console.log("Date set to (local):", localDate);
    } else {
        console.error("matchDate element not found!");
    }

    fetchSettings().then(() => {
        console.log("Settings fetched, loading slots...");
        loadSlots();
    }).catch(e => {
        console.error("Init Error:", e);
        loadSlots(); // try anyway
    });
});

async function fetchSettings() {
    const doc = await db.collection('settings').doc('admin').get();
    if(doc.exists) {
        const data = doc.data();
        if(data.rate) RATE = data.rate;
    }
}

let unsubscribe = null;

async function loadSlots() {
    const date = document.getElementById('matchDate').value;
    const grid = document.getElementById('slotGrid');
    grid.innerHTML = '<div class="loading-slots">Checking available slots...</div>';

    // Unsubscribe from previous date listener
    if (unsubscribe) unsubscribe();

    unsubscribe = db.collection('bookings').where('date', '==', date)
        .onSnapshot((snapshot) => {
            allBookings = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
            renderSlots();
            renderBookingsList();
        }, (e) => {
            console.error("Sync Error:", e);
            grid.innerHTML = '<div class="loading-slots">Error syncing slots.</div>';
        });
}

function renderBookingsList() {
    const list = document.getElementById('bookingsList');
    const date = document.getElementById('matchDate').value;
    if (!list) return;
    
    if (allBookings.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:var(--muted); padding:20px;">No matches scheduled for <b>${date}</b>.</div>`;
        return;
    }

    list.innerHTML = `<div style="font-size:12px; margin-bottom:15px; opacity:0.6;">Showing matches for: ${date}</div>` + 
    allBookings.map(b => `
        <div style="background:var(--card2); border:1px solid var(--border); border-radius:12px; padding:15px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                <div>
                    <div style="font-weight:800; color:var(--gold); font-size:16px;">${b.st} (${b.hrs} hrs)</div>
                    <div style="font-size:13px; font-weight:700;">${b.nm}</div>
                    <div style="font-size:11px; opacity:0.7;">${b.ph}</div>
                </div>
                <div style="text-align:right;">
                    <span style="background:${getStatusColor(b.status)}; color:#000; padding:4px 10px; border-radius:20px; font-size:10px; font-weight:900; text-transform:uppercase;">${b.status.replace('_', ' ')}</span>
                </div>
            </div>
            <div style="display:flex; gap:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; font-size:11px;">
                <div>Total: <b style="color:var(--text);">Rs. ${b.totalAmt || 0}</b></div>
                <div>Paid: <b style="color:var(--green);">Rs. ${b.advAmt || 0}</b></div>
                <div>Due: <b style="color:#ef4444;">Rs. ${b.due || 0}</b></div>
                ${b.trid ? `<div style="opacity:0.6;">TRID: ${b.trid}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function getStatusColor(s) {
    if (s === 'approved') return '#22c55e';
    if (s === 'pending') return '#f0b429';
    return '#ef4444';
}

async function approveBooking(id) {
    if (!confirm("Approve this booking?")) return;
    try {
        await db.collection('bookings').doc(id).update({ status: 'approved' });
        toast('Booking Approved! ✅', 'ok');
        loadSlots();
    } catch(e) {
        toast('Error: ' + e.message, 'err');
    }
}

function checkManualTime() {
    const h = document.getElementById('manualHour').value;
    const m = document.getElementById('manualMin').value;
    const ampm = document.getElementById('manualAMPM').value;

    const formatted = `${h}:${m} ${ampm}`;
    const newStart = parseTimeToMinutes(formatted);
    const newEnd = newStart + 60; // Assume at least 1 hr for check

    const isBkd = allBookings.some(b => {
        if (b.status === 'cancelled') return false;
        const bStart = parseTimeToMinutes(b.st);
        const bEnd = bStart + (parseFloat(b.hrs || 1) * 60);
        return (newStart < bEnd && newEnd > bStart);
    });

    if (isBkd) {
        toast(`Slot ${formatted} or part of it is already BOOKED! ❌`, 'err');

    } else {
        selectedSlot = formatted;
        renderSlots();
        document.getElementById('bookingForm').style.display = 'block';
        calcPrice();
        toast(`Slot ${formatted} is AVAILABLE! ✅`, 'ok');
    }
}

function renderSlots() {
    const grid = document.getElementById('slotGrid');
    grid.innerHTML = '';
    
    // Define slots for all 24 hours
    const times = [];
    for(let i=0; i<24; i++) {
        let h = i % 12 || 12;
        let ampm = i >= 12 ? 'PM' : 'AM';
        times.push(`${h.toString().padStart(2, '0')}:00 ${ampm}`);
    }

    times.forEach(t => {
        const newStart = parseTimeToMinutes(t);
        const newEnd = newStart + 60; 
        
        const isBkd = allBookings.some(b => {
            if (b.status === 'cancelled') return false;
            const bStart = parseTimeToMinutes(b.st);
            const bEnd = bStart + (parseFloat(b.hrs || 1) * 60);
            return (newStart < bEnd && newEnd > bStart);
        });

        const div = document.createElement('div');
        div.className = `slot ${isBkd ? 'bkd' : 'free'} ${selectedSlot === t ? 'selected' : ''}`;
        div.innerHTML = `<div class="slot-time">${t}</div><div style="font-size:9px;">${isBkd ? 'Booked' : 'Available'}</div>`;

        
        if(!isBkd) {
            div.onclick = () => {
                selectedSlot = t;
                renderSlots();
                document.getElementById('bookingForm').style.display = 'block';
                calcPrice();
            };
        }
        grid.appendChild(div);
    });
}

function calcPrice() {
    const hrs = parseFloat(document.getElementById('matchHrs').value) || 0;
    const price = hrs * RATE;
    document.getElementById('priceVal').textContent = `Rs. ${price.toLocaleString()}`;
}

async function submitBooking() {
    const nm = document.getElementById('custName').value.trim();
    const ph = document.getElementById('custPhone').value.trim();
    const trid = document.getElementById('payTrid').value.trim();
    const date = document.getElementById('matchDate').value;
    const file = document.getElementById('payScreenshot').files[0];
    const hrs = document.getElementById('matchHrs').value;
    const advAmt = parseFloat(document.getElementById('advAmount').value) || 500;
    const submitBtn = document.getElementById('submitBtn');

    if(!nm || !ph || !selectedSlot) {
        toast('Please fill Name, Phone and select a Slot!', 'err');
        return;
    }

    if(!trid && !file) {
        toast('Please enter TRID or upload Screenshot!', 'err');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking availability...";

    // Re-check availability right before submitting (Overlap aware)
    const checkSnap = await db.collection('bookings')
        .where('date', '==', date)
        .get();
    
    const newStart = parseTimeToMinutes(selectedSlot);
    const newEnd = newStart + (parseFloat(hrs) * 60);

    const activeBookings = checkSnap.docs.filter(d => {
        const b = d.data();
        if (b.status === 'cancelled') return false;
        const bStart = parseTimeToMinutes(b.st);
        const bEnd = bStart + (parseFloat(b.hrs || 1) * 60);
        return (newStart < bEnd && newEnd > bStart);
    });

    if (activeBookings.length > 0) {
        toast('Sorry, this slot or time range was just BOOKED! ❌', 'err');
        submitBtn.disabled = false;
        submitBtn.textContent = "CONFIRM BOOKING ✅";
        return;
    }


    submitBtn.textContent = "Processing...";

    let screenshotUrl = "";
    if (file) {
        try {
            const ref = storage.ref(`payments/${Date.now()}_${file.name}`);
            const upload = await ref.put(file);
            screenshotUrl = await upload.ref.getDownloadURL();
        } catch(e) {
            console.error("Upload failed:", e);
        }
    }

    const booking = {
        nm, ph, trid, date, 
        st: selectedSlot,
        hrs: parseFloat(hrs),
        status: 'waiting_approval', // Staff will verify


        source: 'online_web',
        advAmt: advAmt,
        createdAt: new Date().toISOString(),
        totalAmt: parseFloat(hrs) * RATE,
        due: (parseFloat(hrs) * RATE) - advAmt,
        nt: 'Online Booking - TRID: ' + trid,
        screenshot: screenshotUrl
    };

    try {
        toast('Submitting booking...', 'info');
        await db.collection('bookings').add(booking);
        
        // Add to Feed/Activity for Admin
        await db.collection('feed').add({
            txt: `New Online Booking from ${nm} for ${selectedSlot}`,
            at: new Date().toISOString(),
            type: 'booking'
        });

        // TRIGGER REAL-TIME SIREN/ALERT FOR STAFF
        await db.collection('alerts').add({
            txt: `🚨 NEW BOOKING: ${nm} @ ${selectedSlot}`,
            at: new Date().toISOString(),
            status: 'new'
        });

        toast('Booking Submitted! Staff will contact you shortly. ✅', 'ok');
        document.getElementById('successOverlay').style.display = 'flex';
        // setTimeout(() => {
        //     window.location.reload();
        // }, 3000);

    } catch(e) {
        toast('Error: ' + e.message, 'err');
    }
}

async function triggerAlarm() {
    try {
        const nm = document.getElementById('custName').value.trim() || 'A Customer';
        await db.collection('alerts').add({
            txt: `🚨 Emergency: ${nm} needs attention at the desk!`,
            at: new Date().toISOString()
        });
        toast('Staff alerted! 🔔', 'ok');
    } catch(e) {
        console.error("Alarm failed:", e);
        toast('Failed to alert staff.', 'err');
    }
}
function toast(msg, type) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = type === 'err' ? '#ef4444' : (type === 'info' ? '#3b82f6' : '#22c55e');
    t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 4000);
}

function scrollToBooking() {
    document.getElementById('booking').scrollIntoView({ behavior: 'smooth' });
}

function updatePayInstr() {
    const amt = document.getElementById('advAmount').value;
    const el = document.getElementById('payInstrAmt');
    if (el) el.textContent = `Rs. ${parseInt(amt).toLocaleString()}`;
}

// Hide loading overlay
window.addEventListener('load', () => {
    setTimeout(() => {
        const loader = document.getElementById('loadingOverlay');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);
        }
    }, 300);
});
