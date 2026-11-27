# Mankaleshwar Mahadev Website — Requirements

## 1. Project Overview

Build a responsive website for Mankaleshwar Mahadev Temple that allows visitors to view temple photos, follow announcements about upcoming events, and subscribe to notification channels. One administrator will manage photos, announcements, and channel messages.

## 2. Admin Site Requirements

The single administrator must be able to:

1. **Manage photos**
   - Add and publish photos of the Shivling.

2. **Publish announcements**
   - Publish announcement posters and/or text messages about special programs, upcoming events, and Mahapujas.

3. **Send channel messages**
   - Send messages through the website's notification channels.

## 3. User Site Requirements

Visitors must be able to:

1. **View and interact with photos**
   - View photos of the Shivling.
   - Filter photos by their upload date (not the date the photo was taken).
   - Like photos and remove their own likes.
   - Select predefined comments, including "Har Har Mahadev".
   - Submit their own custom comments.
   - See comments immediately after submission; admin approval is not required.
   - Download photos.

2. **Contact the pujari/admin**
   - The website must provide a way for visitors to contact the pujari or administrator.
   - The exact contact method is not decided yet and must be confirmed before implementation.

3. **View announcements**
   - View posters and messages about upcoming events, special programs, and Mahapujas.
   - See the date on which each announcement was published.

4. **Use the separate website pages**
   - The user-facing site must have the pages described below.

## 4. User-Facing Pages

### 4.1 Photos
- This will be the first page visitors see when they open the website.
- Display photos of the Shivling.
- Allow visitors to filter photos by upload date.
- Allow visitors to like, remove their likes, comment on, and download photos.

### 4.2 Announcements
- Display announcements about upcoming events, special programs, and Mahapujas.
- Support announcement posters and text messages.
- Show the announcement publication date.

### 4.3 Channels

The website will have two separate notification channels:

#### Photos
- Visitors can subscribe to this channel.
- Subscribers receive notifications when new photos are published.

#### Announcements
- Visitors can subscribe to this channel.
- Subscribers receive notifications about upcoming events and announcements.

## 5. Visitor Access
- Visitors should be able to browse the public website without creating an account.
- Visitors should be able to like, comment on, and download photos as guests.
- Channel subscriptions are separate from creating a website account.

## 6. Confirmed Technical Decisions
- There will be exactly one administrator account.
- PostgreSQL is the database.
- Media storage will use a private Backblaze B2 bucket.

## 7. Decisions Still Pending
- The exact method for contacting the pujari/administrator.
- Push notification delivery provider and VAPID key management details.
- Comment spam-prevention and abuse-handling policy.
- Photo storage limits and retention policy.
- Announcement scheduling, expiry, and editing/deletion rules.

## 8. General Quality Expectations
- The website should be responsive across mobile, tablet, and desktop screens.
- Preserve a clear distinction between the public user site and the admin site.
- Do not introduce features or workflows that are not supported by confirmed requirements.
