# 📊 Database Status Report
**Generated:** 2026-10-01 11:45 AM (IST - 5:15 PM local)

---

## 🗄️ Current Database Contents

### **Tables Status:**

#### 1. **Bookings Table**
```
Status: EMPTY (0 bookings)
```
- No bookings created yet
- All slots available for today and future dates

#### 2. **Reviews Table**
```
Status: EMPTY (0 reviews)
```
- No customer reviews submitted yet

#### 3. **News Posts Table**
```
Status: EMPTY (0 posts)
```
- No tournament announcements or news posted yet

#### 4. **Blocked Slots Table**
```
Status: EMPTY (0 blocked dates)
```
- No slots blocked by admin
- All dates fully available

#### 5. **Host Users Table**
```
Status: ACTIVE (1 admin account)
```
- Username: `admin`
- Password: `<redacted - stored hashed; set via backend/.env ADMIN_PASSWORD>`
- Status: ✅ Created and ready

---

## 📅 Today's Availability (2026-10-01)

### **Current Time:** 5:15 PM IST (17:15 hours)

### **Past Slots (Already Started - Not Bookable):**
- 06:00 - 07:00 AM ❌ Past
- 07:00 - 08:00 AM ❌ Past
- 08:00 - 09:00 AM ❌ Past
- 09:00 - 10:00 AM ❌ Past
- 10:00 - 11:00 AM ❌ Past
- 11:00 - 12:00 PM ❌ Past
- 12:00 - 01:00 PM ❌ Past
- 01:00 - 02:00 PM ❌ Past
- 02:00 - 03:00 PM ❌ Past
- 03:00 - 04:00 PM ❌ Past
- 04:00 - 05:00 PM ❌ Past
- 05:00 - 06:00 PM ❌ Past

### **Available Slots (Still Bookable Today):**
- 06:00 - 07:00 PM ✅ Available (₹1000/hr)
- 07:00 - 08:00 PM ✅ Available (₹1000/hr)
- 08:00 - 09:00 PM ✅ Available (₹1000/hr)
- 09:00 - 10:00 PM ✅ Available (₹1000/hr)

**Total Available Today:** 4 evening slots (₹4000 total revenue potential)

---

## 💡 Database Information

### **Database Type:**
- **Dev Mode:** PGlite (embedded, in-memory)
- **Location:** Running inside Node.js process
- **Persistence:** ⚠️ Data will be LOST when server stops
- **For Production:** Switch to PostgreSQL (persistent storage)

### **Schema Created:**
✅ bookings  
✅ reviews  
✅ news_posts  
✅ host_users  
✅ blocked_slots  
✅ archive_bookings  

All tables initialized successfully with proper indexes and constraints.

---

## 🧪 Test the Database

### **Create a Test Booking:**
1. Go to http://localhost:4000
2. Scroll to "Book Your Slot"
3. Select tomorrow's date
4. Choose 2-3 morning slots (₹500/hr each)
5. Fill in test data:
   - Name: Test User
   - Phone: 9876543210
6. Click "Pay ₹100 Advance & Book"
   - (Will show payment window but fail without Razorpay keys)

### **Submit a Test Review:**
1. Scroll to "Reviews" section
2. Fill in:
   - Name: Test Customer
   - Rating: 5 stars
   - Review: Great turf quality!
3. Click "Submit Review"
4. ✅ Review will appear immediately

### **Post Test News:**
1. Login to admin dashboard
2. Scroll to "Tournament Posters, Images & News"
3. Fill in:
   - Title: Test Tournament
   - Description: Coming soon!
4. Click "Post"
5. ✅ Will appear on homepage

---

## 📊 How to View Database Contents

### **Via API (Public Endpoints):**
```bash
# Get all reviews
curl http://localhost:4000/api/reviews

# Get news posts
curl http://localhost:4000/api/news

# Check slot availability for a date
curl "http://localhost:4000/api/bookings/slots?date=2026-10-02"

# Look up bookings by phone
curl "http://localhost:4000/api/bookings/lookup?phone=9876543210"
```

### **Via Admin Dashboard (Protected):**
1. Login at http://localhost:4000/host.html
2. View all bookings, revenue, and analytics
3. See complete database statistics

---

## ⚠️ Important Notes

1. **Data Loss Warning:**
   - Current dev server uses PGlite (in-memory)
   - All data is LOST when you stop the server
   - For real usage, configure PostgreSQL in `.env`

2. **Production Database:**
   - Add to `backend/.env`:
     ```
     DATABASE_URL=postgres://user:pass@host:5432/dbname
     ```
   - Restart with: `node server.js` (not dev-server.js)
   - Data will persist permanently

3. **Database Backup:**
   - Currently no backup needed (dev mode, no data)
   - With PostgreSQL: automatic backups via provider (Neon/Supabase)

---

## 🔍 Database Schema Details

### **Bookings Table Columns:**
- id (TEXT) - Booking ID like "TA1717-123456"
- name (TEXT) - Customer name
- phone (TEXT) - 10-digit phone number
- date (TEXT) - Booking date (YYYY-MM-DD)
- sport (TEXT) - football | cricket
- format (TEXT) - 5s | 6s
- slots (JSON) - Array of time slots
- totalAmount (INTEGER) - Total cost in ₹
- advanceAmount (INTEGER) - Advance paid in ₹
- balanceAmount (INTEGER) - Balance due in ₹
- status (TEXT) - pending-payment | advance-paid | completed | cancelled
- paymentMode (TEXT) - online | cash
- balanceStatus (TEXT) - due | collected
- createdAt (TEXT) - ISO timestamp
- paymentId (TEXT) - Razorpay payment ID
- refundStatus (TEXT) - Refund status if any
- deletedAt (TEXT) - Soft delete timestamp
- collectedCash (INTEGER) - Cash collected at turf
- collectedOnline (INTEGER) - Online transfer collected

### **Reviews Table Columns:**
- id (SERIAL) - Auto-increment ID
- name (TEXT) - Reviewer name
- rating (INTEGER) - 1-5 stars
- text (TEXT) - Review content
- createdAt (TEXT) - ISO timestamp

### **News Posts Table Columns:**
- id (SERIAL) - Auto-increment ID
- title (TEXT) - Post title
- description (TEXT) - Post description
- imagePath (TEXT) - Uploaded image path
- createdAt (TEXT) - ISO timestamp

---

**Database is running and ready for testing!** 🎉

Create some test bookings and reviews to see the system in action!
