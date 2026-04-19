const firebaseConfig={apiKey:"AIzaSyBfhbjD0b8UaISn1QrK6E-Ci5Yr7HcUTzA",authDomain:"sultans-cricket.firebaseapp.com",projectId:"sultans-cricket",storageBucket:"sultans-cricket.firebasestorage.app",messagingSenderId:"975861366304",appId:"1:975861366304:web:6bfef2fc3e3b01d0284645"};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let allBookings = [];
let selectedSlot = null;
let RATE = 2000; // Default

// Init
document.addEventListener('DOMContentLoaded', () => {
    console.log("Public App initializing...");
    // Set min date to today
    const dt = document.getElementById('matchDate');
    if (dt) {
        const today = new Date().toISOString().split('T')[0];
        dt.min = today;
        dt.value = today;
        console.log("Date set to:", today);
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

async function loadSlots() {
    const date = document.getElementById('matchDate').value;
    const grid = document.getElementById('slotGrid');
    grid.innerHTML = '<div class="loading-slots">Checking available slots...</div>';

    try {
        const snapshot = await db.collection('bookings').where('date', '==', date).get();
        allBookings = snapshot.docs.map(d => d.data());
        renderSlots();
    } catch(e) {
        grid.innerHTML = '<div class="loading-slots">Error loading slots. Try again.</div>';
    }
}

function renderSlots() {
    const grid = document.getElementById('slotGrid');
    grid.innerHTML = '';
    
    // Define slots from 10 AM to 2 AM (next day)
    const times = [
        "10:00 AM", "11:00 AM", "12:00 PM", "01:00 PM", "02:00 PM", "03:00 PM", 
        "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM", 
        "10:00 PM", "11:00 PM", "12:00 AM", "01:00 AM"
    ];

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
    const hrs = document.getElementById('matchHrs').value;

    if(!nm || !ph || !trid || !selectedSlot) {
        toast('Please fill all fields and select a slot!', 'err');
        return;
    }

    if(trid.length < 8) {
        toast('Invalid Transaction ID!', 'err');
        return;
    }

    const booking = {
        nm, ph, trid, date, 
        st: selectedSlot,
        hrs,
        status: 'pending', // Staff will verify TRID
        source: 'online_web',
        advAmt: 500,
        createdAt: new Date().toISOString(),
        totalAmt: parseFloat(hrs) * RATE,
        due: (parseFloat(hrs) * RATE) - 500,
        nt: 'Online Booking - TRID: ' + trid
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
