const firebaseConfig={apiKey:"AIzaSyBfhbjD0b8UaISn1QrK6E-Ci5Yr7HcUTzA",authDomain:"sultans-cricket.firebaseapp.com",projectId:"sultans-cricket",storageBucket:"sultans-cricket.firebasestorage.app",messagingSenderId:"975861366304",appId:"1:975861366304:web:6bfef2fc3e3b01d0284645"};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();
var messaging = null;
try {
    if (firebase.messaging.isSupported()) {
        messaging = firebase.messaging();
    }
} catch (e) { console.warn("Messaging not supported:", e); }

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


async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onerror = () => reject(new Error("Image Load Error"));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 600; // Compact size for Firestore (1MB limit)
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // Return as Base64 Data URL (JPEG, 50% quality for small size)
                resolve(canvas.toDataURL('image/jpeg', 0.5));
            };
        };
        reader.onerror = () => reject(new Error("File Read Error"));
    });
}

let allBookings = [];
let selectedSlot = null;
let RATE = 2000; // Default

// Init
document.addEventListener('DOMContentLoaded', async () => {
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

    // Request notification permission
    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    // Check for pending approval
    const pendingId = localStorage.getItem('lastBookingId');
    if (pendingId) {
        startApprovalListener(pendingId);
        registerMessaging(pendingId);
    }
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
            allBookings = snapshot.docs.map(d => ({id: d.id, ...d.data()}))
                .filter(b => !b.isDeleted); // Ignore soft-deleted
            // Update live date display
            const liveDate = document.getElementById('liveDateDisplay');
            const slotGridLabel = document.getElementById('slotGridLabel');
            const scheduleTitle = document.getElementById('scheduleTitle');
            
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const dObj = new Date(date);
            const dateStr = dObj.toLocaleDateString('en-PK', options);

            if(liveDate) liveDate.textContent = dateStr;
            if(slotGridLabel) slotGridLabel.innerHTML = `📅 Available Slots for <span style="color:#fff;">${dateStr}</span>:`;
            if(scheduleTitle) scheduleTitle.innerHTML = `🏟️ MATCH SCHEDULE: <span style="color:#000;">${dateStr}</span>`;

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
    
    const visibleBookings = allBookings.filter(b => !b.isDeleted);
    
    if (visibleBookings.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:var(--muted); padding:20px;">No matches scheduled for <b>${date}</b>.</div>`;
        return;
    }

    list.innerHTML = visibleBookings.map(b => `
        <div style="background:rgba(255,255,255,0.02); border:1.5px solid var(--border); border-radius:16px; padding:20px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; transition:0.3s; border-left:5px solid ${getStatusColor(b.status)};">
            <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                    <span style="background:rgba(240,180,41,0.1); color:var(--gold); font-size:10px; font-weight:900; padding:2px 8px; border-radius:4px; border:1px solid rgba(240,180,41,0.2);">${b.date}</span>
                    <div style="font-family:'Bebas Neue',sans-serif; font-size:24px; color:var(--text); letter-spacing:1px; line-height:1;">${b.st}</div>
                </div>
                <div style="font-size:11px; color:var(--muted); font-weight:800; margin-top:4px; text-transform:uppercase;">${b.hrs} HOURS MATCH</div>
                <div style="margin-top:12px; display:flex; align-items:center; gap:10px;">
                    <div style="width:30px; height:30px; background:var(--card2); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; border:1px solid var(--border);">🏏</div>
                    <div>
                        <div style="font-weight:900; font-size:15px; color:var(--gold);">${b.nm}</div>
                        <div style="font-size:10px; color:var(--muted); font-weight:700;">PLAYER</div>
                    </div>
                </div>
            </div>
            <div style="text-align:right;">
                <div style="background:${getStatusColor(b.status)}; color:#000; padding:6px 15px; border-radius:30px; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:1px; display:inline-block; margin-bottom:8px;">${b.status === 'waiting_approval' ? 'WAITING VERIFICATION' : b.status.toUpperCase()}</div>
                <div style="font-family:'JetBrains Mono',monospace; font-size:13px; color:var(--muted); font-weight:700;">REF: #${b.id.slice(-6).toUpperCase()}</div>
            </div>
        </div>
    `).join('');
}

function getStatusColor(s) {
    if (s === 'approved' || s === 'pre') return '#22c55e'; // Green
    if (s === 'waiting_approval' || s === 'pending') return '#f0b429'; // Gold
    return '#ef4444'; // Red
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
    const timeVal = document.getElementById('manualStartTime').value;
    if (!timeVal) {
        toast('Please select a time first! ⏰', 'err');
        return;
    }

    // Convert 24h time to 12h format for display
    const [h24, min] = timeVal.split(':');
    let h12 = parseInt(h24) % 12 || 12;
    const ampm = parseInt(h24) >= 12 ? 'PM' : 'AM';
    const formatted = `${String(h12).padStart(2, '0')}:${min} ${ampm}`;

    const newStart = parseTimeToMinutes(formatted);
    const durationHrs = parseFloat(document.getElementById('matchHrs').value) || 1;
    const newEnd = newStart + (durationHrs * 60);

    const isBkd = allBookings.some(b => {
        if (b.status === 'cancelled' || b.isDeleted) return false;
        const bStart = parseTimeToMinutes(b.st);
        const bEnd = bStart + (parseFloat(b.hrs || 1) * 60);
        return (newStart < bEnd && newEnd > bStart);
    });

    if (isBkd) {
        toast(`Time ${formatted} overlaps with an existing booking! ❌`, 'err');
        selectedSlot = null;
    } else {
        selectedSlot = formatted;
        renderSlots();
        document.getElementById('bookingForm').style.display = 'block';
        calcPrice();
        toast(`Slot ${formatted} is AVAILABLE! ✅`, 'ok');
        // Scroll to details
        document.getElementById('bookingForm').scrollIntoView({ behavior: 'smooth' });
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
            if (b.status === 'cancelled' || b.isDeleted) return false;
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
    const adv = price * 0.5;
    document.getElementById('priceVal').textContent = `Rs. ${price.toLocaleString()}`;
    document.getElementById('advAmtDisplay').textContent = `Rs. ${adv.toLocaleString()}`;
    document.getElementById('advAmount').value = adv;
    
    // Also update instructions
    const el = document.getElementById('payInstrAmt');
    if (el) el.textContent = `Rs. ${adv.toLocaleString()}`;
}

function calcPrice() {
    const hrs = parseFloat(document.getElementById('matchHrs').value) || 0;
    const price = hrs * RATE;
    const adv = price * 0.5;
    
    const priceVal = document.getElementById('priceVal');
    const advAmtDisplay = document.getElementById('advAmtDisplay');
    const advAmount = document.getElementById('advAmount');
    const payInstrAmt = document.getElementById('payInstrAmt');

    if (priceVal) priceVal.textContent = `Rs. ${price.toLocaleString()}`;
    if (advAmtDisplay) advAmtDisplay.textContent = `Rs. ${adv.toLocaleString()}`;
    if (advAmount) advAmount.value = adv;
    if (payInstrAmt) payInstrAmt.textContent = `Rs. ${adv.toLocaleString()}`;
}

async function submitBooking() {
    const submitBtn = document.getElementById('submitBtn');
    const nm = document.getElementById('custName').value.trim();
    const ph = document.getElementById('custPhone').value.trim();
    const hrs = document.getElementById('matchHrs').value;
    const advAmt = parseFloat(document.getElementById('advAmount').value) || 0;
    const payTridEl = document.getElementById('payTrid');
    const trid = payTridEl ? payTridEl.value.trim() : '';
    const date = document.getElementById('matchDate').value;
    const file = document.getElementById('payScreenshot').files[0];

    if (!nm || !ph || !hrs || !selectedSlot) {
        toast('Please fill Name, Phone and select a Slot! ⚠️', 'err');
        return;
    }

    if (!file) {
        toast('Payment Screenshot upload karna LAZMI hai! 📸', 'err');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving Booking...";

    try {
        // Re-check availability right before submitting
        const checkSnap = await db.collection('bookings')
            .where('date', '==', date)
            .get();
        
        const newStart = parseTimeToMinutes(selectedSlot);
        const newEnd = newStart + (parseFloat(hrs) * 60);

        const activeBookings = checkSnap.docs.filter(d => {
            const b = d.data();
            if (b.status === 'cancelled' || b.isDeleted) return false;
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
                submitBtn.textContent = "Processing Image...";
                screenshotUrl = await compressImage(file);
                console.log("Image processed to Base64 (Size: " + Math.round(screenshotUrl.length/1024) + " KB)");
            } catch(e) {
                console.error("Image error:", e);
                alert("IMAGE ERROR: " + e.message);
                submitBtn.disabled = false;
                submitBtn.textContent = "CONFIRM BOOKING ✅";
                return;
            }
        }

        submitBtn.textContent = "Saving Booking...";

        const booking = {
            nm, ph, trid: trid || 'N/A', date, 
            st: selectedSlot,
            hrs: parseFloat(hrs),
            status: 'waiting_approval',
            source: 'online_web',
            advAmt: advAmt,
            createdAt: new Date().toISOString(),
            totalAmt: parseFloat(hrs) * RATE,
            due: (parseFloat(hrs) * RATE) - advAmt,
            nt: 'Online Booking' + (trid ? ' - TRID: ' + trid : ''),
            screenshot: screenshotUrl
        };

        const docRef = await db.collection('bookings').add(booking);
        
        // Add to Feed/Activity for Admin
        await db.collection('feed').add({
            txt: `New Online Booking from ${nm} for ${selectedSlot}`,
            at: firebase.firestore.Timestamp.now(), // Use server-side consistent timestamp
            type: 'booking',
            screenshot: screenshotUrl
        });

        // TRIGGER REAL-TIME SIREN/ALERT FOR STAFF
        await db.collection('alerts').add({
            txt: `🚨 NEW BOOKING: ${nm} @ ${selectedSlot}`,
            at: firebase.firestore.Timestamp.now(), // Instant trigger for siren
            status: 'new',
            screenshot: screenshotUrl
        });

        submitBtn.textContent = "Waiting for Approval ⏳";
        submitBtn.style.background = "var(--blue)";
        submitBtn.style.color = "#fff";
        toast('Booking sent for approval! ✅', 'ok');
        
        // Save to local storage to track approval
        localStorage.setItem('lastBookingId', docRef.id);
        localStorage.setItem('lastBookingStatus', 'waiting_approval');
        
        document.getElementById('successOverlay').style.display = 'flex';
        startApprovalListener(docRef.id);

    } catch(e) {
        console.error("Booking Submission Error:", e);
        toast('Error: ' + e.message, 'err');
        submitBtn.disabled = false;
        submitBtn.textContent = "CONFIRM BOOKING ✅";
    }
}

function startApprovalListener(id) {
    if (!id) return;
    db.collection('bookings').doc(id).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            if (data.status === 'approved' || data.status === 'pre') {
                showApprovalNotification(data);
                localStorage.removeItem('lastBookingId');
                localStorage.removeItem('lastBookingStatus');
            } else if (data.status === 'rejected' || data.status === 'cancelled') {
                toast('Your booking was ' + data.status + '.', 'err');
                localStorage.removeItem('lastBookingId');
                localStorage.removeItem('lastBookingStatus');
            }
        }
    });
}

function showApprovalNotification(data) {
    // Show a prominent success modal
    const overlay = document.getElementById('successOverlay');
    if (overlay) {
        overlay.innerHTML = `
            <div class="success-card" style="text-align:center; background:var(--card); padding:30px; border-radius:24px; border:2px solid var(--gold); box-shadow:0 0 50px rgba(240,180,41,0.2); max-width:90%; animation: slideUp 0.5s ease-out;">
                <div style="font-size:60px; margin-bottom:20px;">🎊</div>
                <h2 style="font-family:'Bebas Neue',sans-serif; font-size:32px; color:var(--gold); letter-spacing:2px; margin-bottom:10px;">CONGRATULATIONS!</h2>
                <p style="font-size:16px; color:#fff; font-weight:700; margin-bottom:20px;">Your booking for <b>${data.st}</b> has been <span style="color:var(--green);">APPROVED</span>! ✅</p>
                <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:12px; margin-bottom:20px; text-align:left; font-size:13px;">
                    <div style="margin-bottom:5px; color:var(--muted);">Match Details:</div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span>📅 Date:</span> <b>${data.date}</b></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span>⏰ Time:</span> <b>${data.st}</b></div>
                    <div style="display:flex; justify-content:space-between;"><span>⏳ Duration:</span> <b>${data.hrs} Hours</b></div>
                </div>
                <button onclick="location.reload()" style="background:var(--gold); color:#000; border:none; padding:12px 30px; border-radius:12px; font-weight:900; cursor:pointer; width:100%; font-family:'Nunito',sans-serif;">GREAT, THANKS! 🏏</button>
            </div>
        `;
        overlay.style.display = 'flex';
    }
    
    // Also try browser notification (check exists first for iOS Safari)
    if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
        showNotification("Booking Approved! 🏏", {
            body: `Congratulations! Your booking for ${data.st} is confirmed.`,
            icon: "img/logo.png"
        });
    }
}

function showNotification(title, options) {
    if ("serviceWorker" in navigator && Notification.permission === "granted") {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, options);
        }).catch(err => {
            console.error("SW Notification failed, falling back:", err);
            new Notification(title, options);
        });
    } else if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, options);
    }
}

// Background Token Registration for Customer
async function registerMessaging(bookingId) {
    if (!messaging || !bookingId) return;
    try {
        const token = await messaging.getToken({ vapidKey: 'BMXvX-X_X_X_X_X_X_X_X_X_X' });
        if (token) {
            await db.collection('fcm_tokens').doc(bookingId).set({
                token: token,
                updatedAt: new Date().toISOString(),
                type: 'customer'
            });
            console.log("Customer FCM Token registered");
        }
    } catch (e) { console.warn("Customer FCM Token failed:", e); }
}

// Request permission on first click
document.addEventListener('click', () => {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}, { once: true });

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
