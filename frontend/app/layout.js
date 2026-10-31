import './globals.css';
import Nav from '../components/Nav';

export const metadata = {
  title: 'Cricket Player Auction',
  description: 'Register as a player and follow the live auction',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
