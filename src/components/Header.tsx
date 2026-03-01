import { Link } from "@tanstack/react-router";

export default function Header() {
	return (
		<header className="hidden" aria-hidden>
			<nav>
				<Link to="/">Home</Link>
				<Link to="/dashboard">Dashboard</Link>
			</nav>
		</header>
	);
}
