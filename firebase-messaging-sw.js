importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js","https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({"apiKey":"AIzaSyB563-FOvtOmT1rxT9RNOI2Y6bRu-mEZps","authDomain":"jni-voluntarios.firebaseapp.com","projectId":"jni-voluntarios","storageBucket":"jni-voluntarios.firebasestorage.app","messagingSenderId":"548331463495","appId":"1:548331463495:web:5682dd14589c3c17ec6262"});
const messaging=firebase.messaging();
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
