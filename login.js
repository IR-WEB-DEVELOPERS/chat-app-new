// Firebase Initialization
const firebaseConfig = {
    apiKey: "AIzaSyBclTC8gK3QKi1X6Q-YCK2jT38yJ83xOcQ",
    authDomain: "chat-app-a0f95.firebaseapp.com",
    projectId: "chat-app-a0f95",
    storageBucket: "chat-app-a0f95.appspot.com",
    messagingSenderId: "754786153113",
    appId: "1:754786153113:web:7543bfb097732ad229fe08",
    measurementId: "G-JFKWR83KYJ"
};
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

// Google Login
document.getElementById('googleLogin').onclick = async () => {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        
        // Redirect to chat page on successful login
        window.location.href = 'chat.html';
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please try again.');
    }
};

// Check if user is already logged in
auth.onAuthStateChanged(user => {
    if (user) {
        // Redirect to chat page if already logged in
        window.location.href = 'chat.html';
    }
});