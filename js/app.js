const firebaseConfig={apiKey:"AIzaSyBfhbjD0b8UaISn1QrK6E-Ci5Yr7HcUTzA",authDomain:"sultans-cricket.firebaseapp.com",projectId:"sultans-cricket",storageBucket:"sultans-cricket.firebasestorage.app",messagingSenderId:"975861366304",appId:"1:975861366304:web:6bfef2fc3e3b01d0284645"};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

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
                    <span style="background:${getStatusColor(b.status)}; color:#000; padding:4px 10px; border-radius:20px; font-size:10px; font-weight:900; text-transform:uppercase;">${b.status}</span>
                    <div style="margin-top:5px;">
                        ${b.status === 'pending' ? `<button onclick="approveBooking('${b.id}')" style="background:var(--gold); border:none; padding:5px 10px; border-radius:6px; font-size:11px; font-weight:bold; cursor:pointer; color:#000;">Approve Now</button>` : ''}
                    </div>
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
    const timeVal = document.getElementById('manualTime').value;
    if (!timeVal) {
        toast('Please enter a time first!', 'err');
        return;
    }

    // Convert 24h to 12h format
    let [h, m] = timeVal.split(':');
    h = parseInt(h);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const formatted = `${h.toString().padStart(2, '0')}:${m} ${ampm}`;

    const isBkd = allBookings.some(b => b.st === formatted && b.status !== 'cancelled');
    if (isBkd) {
        toast(`Slot ${formatted} is already BOOKED! ❌`, 'err');
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
    
    // Define slots from 7 AM to 3 AM (next day)
    const times = [];
    for(let i=7; i<=23; i++) {
        let h = i > 12 ? i - 12 : i;
        let ampm = i >= 12 ? 'PM' : 'AM';
        times.push(`${h.toString().padStart(2, '0')}:00 ${ampm}`);
    }
    times.push("12:00 AM", "01:00 AM", "02:00 AM", "03:00 AM");

    times.forEach(t => {
        const isBkd = allBookings.some(b => b.st === t && b.status !== 'cancelled');
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

    // Re-check availability right before submitting
    const checkSnap = await db.collection('bookings')
        .where('date', '==', date)
        .where('st', '==', selectedSlot)
        .get();
    
    const activeBookings = checkSnap.docs.filter(d => d.data().status !== 'cancelled');
    if (activeBookings.length > 0) {
        toast('Sorry, this slot was just BOOKED by someone else! ❌', 'err');
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
        hrs,
        status: 'pending', // Staff will verify
        source: 'online_web',
        advAmt: 500,
        createdAt: new Date().toISOString(),
        totalAmt: parseFloat(hrs) * RATE,
        due: (parseFloat(hrs) * RATE) - 500,
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

        toast('Booking Submitted! Staff will contact you shortly. ✅', 'ok');
        setTimeout(() => {
            window.location.reload();
        }, 3000);

    } catch(e) {
        toast('Error: ' + e.message, 'err');
    }
}

function toast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = type === 'err' ? '#ef4444' : (type === 'info' ? '#3b82f6' : '#22c55e');
    t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 4000);
}

function scrollToBooking() {
    document.getElementById('booking').scrollIntoView({ behavior: 'smooth' });
}
