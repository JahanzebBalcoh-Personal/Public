const firebaseConfig={apiKey:"AIzaSyBfhbjD0b8UaISn1QrK6E-Ci5Yr7HcUTzA",authDomain:"sultans-cricket.firebaseapp.com",projectId:"sultans-cricket",storageBucket:"sultans-cricket.firebasestorage.app",messagingSenderId:"975861366304",appId:"1:975861366304:web:6bfef2fc3e3b01d0284645"};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();
var messaging = null;
try {
    if (firebase.messaging && typeof firebase.messaging.isSupported === 'function' && firebase.messaging.isSupported()) {
        messaging = firebase.messaging();
    }
} catch (e) { console.warn("Messaging not supported:", e); }

db.enablePersistence().catch(err => console.warn("Persistence failed:", err.code));

function normalizePhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('923') && p.length === 12) {
        p = '03' + p.slice(3);
    }
    if (p.startsWith('3') && p.length === 10) {
        p = '0' + p;
    }
    return p;
}


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

    list.innerHTML = visibleBookings.map(b => {
        // Public schedule: show time/name only, NO receipt download (privacy)
        const isApproved = b.status === 'pre' || b.status === 'approved' || b.status === 'paid';
        return `
        <div style="background:rgba(255,255,255,0.02); border:1.5px solid var(--border); border-radius:16px; padding:18px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border-left:5px solid ${getStatusColor(b.status)};">
            <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                    <span style="background:rgba(240,180,41,0.1); color:var(--gold); font-size:10px; font-weight:900; padding:2px 8px; border-radius:4px; border:1px solid rgba(240,180,41,0.2);">${b.date}</span>
                    <div style="font-family:'Bebas Neue',sans-serif; font-size:22px; color:var(--text); letter-spacing:1px; line-height:1;">${b.st}</div>
                </div>
                <div style="font-size:11px; color:var(--muted); font-weight:800; margin-top:3px;">${b.hrs} HOURS &bull; ${b.nm}</div>
            </div>
            <div style="text-align:right;">
                <div style="background:${getStatusColor(b.status)}; color:#000; padding:5px 12px; border-radius:30px; font-size:10px; font-weight:900; display:inline-block;">${isApproved ? '✅ BOOKED' : '⏳ PENDING'}</div>
            </div>
        </div>`;
    }).join('');
}

function getStatusLabel(s) {
    if (s === 'pre') return '✅ CONFIRMED';
    if (s === 'approved') return '✅ APPROVED';
    if (s === 'paid') return '💚 PAID';
    if (s === 'partial') return '🟡 PARTIAL PAID';
    if (s === 'waiting_approval' || s === 'pending') return '⏳ WAITING VERIFICATION';
    if (s === 'rejected') return '❌ REJECTED';
    if (s === 'cancelled') return '🚫 CANCELLED';
    return (s || 'UNKNOWN').toUpperCase();
}

function getStatusColor(s) {
    if (s === 'approved' || s === 'pre' || s === 'paid') return '#22c55e'; // Green
    if (s === 'partial') return '#3b82f6'; // Blue
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

        const normalizedPh = normalizePhone(ph);

        const booking = {
            nm, ph: normalizedPh, trid: trid || 'N/A', date, 
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
        
        // Save phone number for history listener
        localStorage.setItem('scc_last_phone', normalizedPh);
        
        // Start history listener if it wasn't running
        startHistoryListener(normalizedPh);
        
        document.getElementById('successOverlay').style.display = 'flex';
        showSuccessCard({nm:nm, ph:normalizedPh, date:date, st:selectedSlot, hrs:parseFloat(hrs), advAmt:advAmt, totalAmt:parseFloat(hrs)*RATE}, docRef.id);
        startApprovalListener(docRef.id);
        
        // Trigger Telegram Push Notification to Admin
        sendTelegramAlert(booking);

    } catch(e) {
        console.error("Booking Submission Error:", e);
        toast('Error: ' + e.message, 'err');
        submitBtn.disabled = false;
        submitBtn.textContent = "CONFIRM BOOKING ✅";
    }
}

var currentBookingForReceipt = null;
var currentBookingIdForReceipt = null;
var historyListener = null;

function sendTelegramAlert(booking) {
    db.collection('settings').doc('admin').get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            const token = data.telegram_token;
            const chatId = data.telegram_chat_id;
            if (token && chatId) {
                const text = `🏏 *NEW ONLINE BOOKING* 🚨\n\n` +
                             `👤 *Name:* ${booking.nm}\n` +
                             `📞 *Phone:* ${booking.ph}\n` +
                             `📅 *Date:* ${booking.date}\n` +
                             `⏰ *Time:* ${booking.st}\n` +
                             `⏳ *Duration:* ${booking.hrs} Hours\n` +
                             `💰 *Advance:* Rs. ${parseInt(booking.advAmt || 0).toLocaleString()}\n` +
                             `💳 *TRID:* ${booking.trid || 'N/A'}`;
                
                const url = `https://api.telegram.org/bot${token}/sendMessage`;
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: text,
                        parse_mode: 'Markdown'
                    })
                }).then(res => {
                    console.log("Telegram alert sent:", res.status);
                }).catch(err => {
                    console.error("Telegram alert failed:", err);
                });
            }
        }
    }).catch(err => {
        console.error("Failed to load settings for telegram:", err);
    });
}

function startHistoryListener(ph) {
    if (!ph) return;
    if (historyListener) return; // already listening
    historyListener = db.collection('bookings')
        .where('ph', '==', ph)
        .onSnapshot((snap) => {
            var liveBookings = snap.docs.map(function(doc) {
                return Object.assign({id: doc.id}, doc.data());
            }).sort(function(a, b) {
                return (b.createdAt || b.date || '').localeCompare(a.createdAt || a.date || '');
            });
            renderMyBookings(liveBookings);
        }, (err) => {
            console.error("History listen error:", err);
        });
}

function startApprovalListener(id) {
    if (!id) return;
    db.collection('bookings').doc(id).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            if (data.status === 'approved' || data.status === 'pre') {
                showApprovalNotification(data, id);
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

function showApprovalNotification(data, id) {
    // Show a prominent success modal
    const overlay = document.getElementById('successOverlay');
    if (overlay) {
        const safeData = JSON.stringify(data).replace(/"/g, '&quot;');
        overlay.innerHTML = `
            <div class="success-card" style="text-align:center; background:var(--card); padding:30px; border-radius:24px; border:2px solid var(--gold); box-shadow:0 0 50px rgba(240,180,41,0.2); max-width:400px; width: 100%; animation: slideUp 0.5s ease-out;">
                <div style="font-size:60px; margin-bottom:20px;">🎊</div>
                <h2 style="font-family:'Bebas Neue',sans-serif; font-size:32px; color:var(--gold); letter-spacing:2px; margin-bottom:10px;">CONGRATULATIONS!</h2>
                <p style="font-size:16px; color:#fff; font-weight:700; margin-bottom:20px;">Your booking for <b>${data.st}</b> has been <span style="color:var(--green);">APPROVED</span>! ✅</p>
                <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:12px; margin-bottom:20px; text-align:left; font-size:13px;">
                    <div style="margin-bottom:5px; color:var(--muted);">Match Details:</div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span>📅 Date:</span> <b>${data.date}</b></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span>⏰ Time:</span> <b>${data.st}</b></div>
                    <div style="display:flex; justify-content:space-between;"><span>⏳ Duration:</span> <b>${data.hrs} Hours</b></div>
                </div>
                <div style="display:flex; gap:10px; margin-bottom:15px;">
                  <button onclick="downloadReceipt('${id}', ${safeData})" style="flex:1; background:linear-gradient(135deg,var(--green),#15803d); color:#fff; border:none; border-radius:12px; padding:14px; font-family:'Nunito',sans-serif; font-size:13px; font-weight:900; cursor:pointer;">📥 SAVE RECEIPT</button>
                  <button onclick="location.reload()" style="flex:1; background:var(--gold); color:#000; border:none; border-radius:12px; padding:14px; font-family:'Nunito',sans-serif; font-size:13px; font-weight:900; cursor:pointer;">GREAT! 🏏</button>
                </div>
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
    
    // Show my bookings if phone exists
    var ph = localStorage.getItem('scc_last_phone') || '';
    if (ph) {
        startHistoryListener(ph);
    }
});

// Show success card with booking details
function showSuccessCard(bookingData, bookingId) {
    currentBookingForReceipt = bookingData;
    currentBookingIdForReceipt = bookingId;
    
    var overlay = document.getElementById('successOverlay');
    var msg = document.getElementById('successMsg');
    var scDate = document.getElementById('sc-date');
    var scTime = document.getElementById('sc-time');
    var scHrs = document.getElementById('sc-hrs');
    var scAdv = document.getElementById('sc-adv');
    var scRef = document.getElementById('sc-ref');
    
    if (msg) msg.innerHTML = 'Your booking for <b>' + bookingData.st + '</b> has been submitted!<br><small style="color:var(--muted)">Staff will verify your payment and confirm shortly.</small>';
    if (scDate) scDate.textContent = bookingData.date;
    if (scTime) scTime.textContent = bookingData.st;
    if (scHrs) scHrs.textContent = bookingData.hrs + ' Hours';
    if (scAdv) scAdv.textContent = 'Rs. ' + parseInt(bookingData.advAmt || 0).toLocaleString();
    if (scRef) scRef.textContent = '#' + (bookingId || '').slice(-6).toUpperCase();
    if (overlay) overlay.style.display = 'flex';
}

// Download receipt as image
function downloadReceipt(bookingId, bookingData) {
    var lastId = bookingId || currentBookingIdForReceipt || localStorage.getItem('lastBookingId') || '';
    var bk = bookingData || currentBookingForReceipt;
    
    if (!bk) {
        toast('No receipt details found.', 'err');
        return;
    }
    
    var canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 500;
    var ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#060e1a';
    ctx.fillRect(0, 0, 800, 500);
    
    // Gold header bar
    ctx.fillStyle = '#f0b429';
    ctx.fillRect(0, 0, 800, 8);
    
    // Club name
    ctx.fillStyle = '#f0b429';
    ctx.font = 'bold 36px Arial';
    ctx.fillText('SCC - SULTANS CRICKET CLUB', 40, 60);
    
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Arial';
    ctx.fillText('Near Mansion Marriage Club, MA Jinnah Road, Multan', 40, 82);
    
    // Divider
    ctx.strokeStyle = 'rgba(240,180,41,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 100); ctx.lineTo(760, 100); ctx.stroke();
    
    // RECEIPT title
    var isApproved = bk.status === 'approved' || bk.status === 'pre' || bk.status === 'paid' || bk.status === 'partial';
    ctx.fillStyle = isApproved ? '#22c55e' : '#f0b429';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(isApproved ? 'CONFIRMED BOOKING RECEIPT' : 'BOOKING REQUEST RECEIPT', 40, 135);
    
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Arial';
    ctx.fillText('REF: #' + (lastId || '').slice(-6).toUpperCase(), 40, 155);
    
    // Details
    var displayStatus = 'WAITING APPROVAL';
    if (bk.status === 'approved' || bk.status === 'pre') displayStatus = 'APPROVED / CONFIRMED';
    if (bk.status === 'paid') displayStatus = 'PAID / CONFIRMED';
    if (bk.status === 'partial') displayStatus = 'PARTIALLY PAID / CONFIRMED';
    if (bk.status === 'rejected') displayStatus = 'REJECTED';
    if (bk.status === 'cancelled') displayStatus = 'CANCELLED';

    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 16px Arial';
    var details = [
        ['Name:', bk.nm || '-'],
        ['Phone:', bk.ph || '-'],
        ['Date:', bk.date || '-'],
        ['Time:', bk.st || '-'],
        ['Duration:', (bk.hrs || '-') + ' Hours'],
        ['Advance Paid:', 'Rs. ' + parseInt(bk.advAmt || 0).toLocaleString()],
        ['Total Amount:', 'Rs. ' + parseInt(bk.totalAmt || 0).toLocaleString()],
        ['Status:', displayStatus],
    ];
    details.forEach(function(row, i) {
        ctx.fillStyle = '#64748b';
        ctx.fillText(row[0], 40, 200 + i * 32);
        if (row[0] === 'Status:') {
            ctx.fillStyle = isApproved ? '#22c55e' : '#f0b429';
        } else {
            ctx.fillStyle = '#f1f5f9';
        }
        ctx.fillText(row[1], 250, 200 + i * 32);
    });
    
    // Footer
    ctx.strokeStyle = 'rgba(240,180,41,0.2)';
    ctx.beginPath(); ctx.moveTo(40, 465); ctx.lineTo(760, 465); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Arial';
    ctx.fillText('sultan.jahanzebbaloch.com | System by Jahanzeb Baloch', 40, 485);
    ctx.fillText(new Date().toLocaleString(), 560, 485);
    
    // Download receipt
    var link = document.createElement('a');
    link.download = 'SCC-Receipt-' + (lastId || '').slice(-6).toUpperCase() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Receipt downloaded! 📥', 'ok');
    
    // WhatsApp share option
    setTimeout(function() {
        var shareText = encodeURIComponent(
            '🏏 *Sultan Cricket Club - Booking Receipt*\n\n' +
            '👤 Name: ' + (bk.nm || '-') + '\n' +
            '📅 Date: ' + (bk.date || '-') + '\n' +
            '⏰ Time: ' + (bk.st || '-') + '\n' +
            '⏳ Hours: ' + (bk.hrs || '-') + ' Hrs\n' +
            '💰 Total: Rs. ' + parseInt(bk.totalAmt || 0).toLocaleString() + '\n' +
            '✅ Status: ' + (isApproved ? 'CONFIRMED / APPROVED' : 'WAITING APPROVAL') + '\n' +
            '📌 REF: #' + (lastId || '').slice(-6).toUpperCase() + '\n\n' +
            'sultan.jahanzebbaloch.com'
        );
        if (confirm('📲 Receipt download ho gayi! WhatsApp pe bhi share karein?')) {
            window.open('https://wa.me/?text=' + shareText, '_blank');
        }
    }, 800);
}

// ─── MY BOOKINGS SECTION ───
function showMyBookingsPrompt() {
    var section = document.getElementById('myBookingsSection');
    if (!section) return;
    var savedPh = localStorage.getItem('scc_last_phone') || '';
    if (savedPh) {
        // Already have phone, load directly
        startHistoryListener(savedPh);
        section.scrollIntoView({ behavior: 'smooth' });
        return;
    }
    // Show phone entry prompt
    section.style.display = 'block';
    section.innerHTML = `
    <h2 class="sh-t" style="margin-bottom:15px;">📋 My Booking History</h2>
    <div style="background:var(--card); border:1.5px solid var(--border); border-radius:16px; padding:24px; text-align:center;">
        <div style="font-size:40px; margin-bottom:12px;">📱</div>
        <div style="font-weight:900; font-size:16px; margin-bottom:8px; color:var(--text);">Apna Phone Number Daalo</div>
        <div style="font-size:12px; color:var(--muted); margin-bottom:20px;">Booking karte waqt jo number diya tha wahi daalo</div>
        <div style="display:flex; gap:10px; max-width:340px; margin:0 auto;">
            <input type="tel" id="historyPhoneInp" placeholder="03XXXXXXXXX" maxlength="11"
                style="flex:1; background:var(--card2); border:1.5px solid var(--border); border-radius:10px; padding:12px 14px; font-size:15px; font-weight:700; color:var(--text); outline:none; text-align:center; font-family:'Nunito',sans-serif;"
                onkeydown="if(event.key==='Enter') lookupMyBookings()">
            <button onclick="lookupMyBookings()" style="background:var(--gold); color:#000; border:none; border-radius:10px; padding:12px 18px; font-weight:900; font-size:13px; cursor:pointer; white-space:nowrap;">DEKHO 🔎</button>
        </div>
        <div id="historyPhoneErr" style="font-size:12px; color:var(--red); margin-top:10px; font-weight:700;"></div>
    </div>`;
    section.scrollIntoView({ behavior: 'smooth' });
}

function lookupMyBookings() {
    var inp = document.getElementById('historyPhoneInp');
    var err = document.getElementById('historyPhoneErr');
    if (!inp) return;
    var ph = inp.value.trim().replace(/\D/g, '');
    if (ph.length < 10) { if(err) err.textContent = '❌ Valid phone number daalo (e.g. 03001234567)'; return; }
    if (ph.startsWith('3') && ph.length === 10) ph = '0' + ph;
    localStorage.setItem('scc_last_phone', ph);
    if (err) err.textContent = '';
    startHistoryListener(ph);
}

// Render My Bookings section
function renderMyBookings(liveBookings) {
    var ph = localStorage.getItem('scc_last_phone') || '';
    if (!ph) return;
    
    var section = document.getElementById('myBookingsSection');
    if (!section) {
        section = document.createElement('div');
        section.id = 'myBookingsSection';
        section.className = 'section booking-container';
        section.style = 'padding-top:40px;';
        var footer = document.querySelector('.footer');
        if (footer) footer.parentNode.insertBefore(section, footer);
    }
    
    if (!liveBookings || !liveBookings.length) {
        section.style.display = 'block';
        section.innerHTML = `
        <h2 class="sh-t" style="margin-bottom:15px;">📋 My Booking History</h2>
        <div style="background:var(--card); border:1.5px solid var(--border); border-radius:16px; padding:30px; text-align:center;">
            <div style="font-size:40px; margin-bottom:10px;">🏏</div>
            <div style="font-size:14px; color:var(--muted); font-weight:700;">Koi booking nahi mili <b>${ph}</b> ke liye</div>
            <button onclick="localStorage.removeItem('scc_last_phone'); showMyBookingsPrompt()" style="margin-top:15px; background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--muted); border-radius:8px; padding:8px 16px; font-size:11px; cursor:pointer;">Doosra number try karo</button>
        </div>`;
        return;
    }
    section.style.display = 'block';
    
    var itemsHTML = liveBookings.map(function(b) {
        var isApproved = b.status === 'pre' || b.status === 'approved' || b.status === 'paid' || b.status === 'partial';
        var statusLabel = '⏳ Waiting';
        var statusColor = '#f0b429';
        if (b.status === 'pre' || b.status === 'approved') { statusLabel = '✅ Confirmed'; statusColor = '#22c55e'; }
        if (b.status === 'paid') { statusLabel = '💵 Paid'; statusColor = '#22c55e'; }
        if (b.status === 'partial') { statusLabel = '🟡 Partial'; statusColor = '#3b82f6'; }
        if (b.status === 'rejected' || b.status === 'cancelled') { statusLabel = '❌ Cancelled'; statusColor = '#ef4444'; }
        
        const safeData = JSON.stringify(b).replace(/"/g, '&quot;');
        var receiptBtn = isApproved
            ? '<button onclick="downloadReceipt(\'' + b.id + '\', ' + safeData + ')" style="background:linear-gradient(135deg,#22c55e,#15803d); color:#fff; border:none; padding:7px 14px; font-size:10px; font-weight:900; border-radius:8px; cursor:pointer; margin-top:6px; width:100%;">📥 RECEIPT + SHARE</button>'
            : '<div style="font-size:10px; color:var(--muted); margin-top:6px; font-weight:700;">Receipt after approval</div>';
        
        return '<div style="background:var(--card); border:1.5px solid var(--border); border-left:4px solid ' + statusColor + '; border-radius:14px; padding:16px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:flex-start;">'+
            '<div style="flex:1;">'+
            '<div style="font-family:\'Bebas Neue\',sans-serif; font-size:20px; color:var(--text); line-height:1.1;">' + b.st + '</div>'+
            '<div style="font-size:11px; color:var(--gold); font-weight:800; margin-top:2px;">' + b.date + ' &bull; ' + b.hrs + ' Hrs</div>'+
            '<div style="font-size:10px; color:var(--muted); margin-top:3px;">Rs. ' + parseInt(b.totalAmt||b.fin||0).toLocaleString() + ' Total &bull; Rs. ' + parseInt(b.advAmt||0).toLocaleString() + ' Paid</div>'+
            '<div style="font-size:9px; color:var(--muted); margin-top:2px; font-family:\'JetBrains Mono\',monospace;">REF: #' + b.id.slice(-6).toUpperCase() + '</div>'+
            '</div>'+
            '<div style="text-align:right; min-width:110px;">'+
            '<span style="background:rgba(255,255,255,0.04); color:' + statusColor + '; font-size:10px; font-weight:900; padding:4px 10px; border-radius:20px; border:1px solid ' + statusColor + '; white-space:nowrap;">' + statusLabel + '</span>'+
            receiptBtn +
            '</div></div>';
    }).join('');
    
    section.innerHTML = 
        '<h2 class="sh-t" style="margin-bottom:6px;">📋 My Booking History</h2>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">'+
        '<p style="font-size:12px; color:var(--muted); margin:0;">📱 ' + ph + '</p>'+
        '<button onclick="localStorage.removeItem(\'scc_last_phone\'); historyListener=null; showMyBookingsPrompt()" style="background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--muted); border-radius:6px; padding:4px 10px; font-size:10px; cursor:pointer;">🔄 Change</button>'+
        '</div>'+
        '<div style="max-height:420px; overflow-y:auto; padding-right:4px;">' + itemsHTML + '</div>';
}
