WebAR Sticker Filter with MindAR - Requirements
1. Face Tracking & Sticker AR Filter:

The app will use MindAR for real-time face tracking to detect facial features (eyes, nose, mouth, face shape).

Stickers (such as glasses, hats, makeup, etc.) will be applied to the user's face in real-time and will be moveable, resizable, and rotatable by the user.

Stickers will be created in SVG (Scalable Vector Graphics) format to ensure high-quality, resolution-independent images that can be scaled and manipulated without losing quality.

2. Image Upload & QR Code Generation:

Users can upload an image (e.g., a selfie) to the app, which will act as a sticker in the AR scene.

After uploading, the image will be saved on the server (not locally on the device). A unique QR code will be generated for the uploaded image and AR filter.

The QR code will be the only way to access the uploaded image and AR filter. Users can upload images on one device (e.g., desktop) and then access the AR experience via the QR code on another device (e.g., mobile phone).

3. Sticker Interaction (Instagram-like Controls):

Drag-and-Drop Interaction: Users can drag stickers (including the uploaded image) to move them around the screen using touch gestures on mobile or mouse on desktop.

Pinch-to-Zoom (Resize): Users can resize stickers by pinching with two fingers on mobile devices or dragging the corners on desktop.

Rotation: Users can rotate stickers using a rotation gesture (rotate two fingers on mobile or dragging a rotation icon on desktop).

Layering (Send Forward/Backward): Users can layer stickers, sending them forward or backward, just like on Instagram.

Delete or Reset: Stickers can be deleted using a trash icon or reset to their default size/position using a reset icon.

4. Real-Time Sticker Application:

Stickers and the uploaded image will automatically align with the user's face in real-time, adjusting their position as the user moves or changes facial expressions.

5. Background Removal (Optional):

Users will have the option to remove the background from their uploaded image using Cloudinary API or OpenCV.js.

The uploaded image (acting as a sticker) will remain properly aligned with the face, even after background removal.

6. Mobile-Friendly UI:

The app should have a responsive, mobile-friendly UI that works smoothly on Android, iOS, and PC.

The user interface should adapt to different screen sizes and touch-based inputs (on mobile) to ensure smooth interactions with AR stickers and image upload.

7. AR View:

The app will display the user's face with the AR stickers applied directly in the browser, providing a real-time AR experience that works across mobile and desktop devices.

8. Cross-Platform Compatibility:

The app should function as a Progressive Web App (PWA), providing a native app-like experience on different devices and platforms (mobile, tablet, desktop).

9. Performance:

The app should provide real-time performance for face tracking and sticker manipulation, allowing users to interact with the stickers smoothly and with minimal delay.