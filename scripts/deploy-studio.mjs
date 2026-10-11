console.log('Gym Studio uses two Coolify applications: this frontend Dockerfile and the separate gym-studio-backend Dockerfile.');
console.log('Configure the private PostgreSQL resource, HTTPS origin, SMTP and AI provider in docs/self-hosting.md, then deploy both applications in Coolify.');
console.log('For a local deployment rehearsal, run docker compose up -d --build.');
process.exitCode = 1; // Deployment has not occurred; never report a successful partial publish.
