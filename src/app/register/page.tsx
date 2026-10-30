import AuthForm from '../auth-form';
export default function Page() { return <main className="auth-page"><section className="auth-intro"><p className="brand">Booking B2B</p><h1>Buat akun pelanggan</h1><p>Jadwal layanan, jelas dalam satu tempat.</p></section><section className="auth-panel"><h2>Mulai dengan akun Anda</h2><AuthForm register /></section></main>; }
