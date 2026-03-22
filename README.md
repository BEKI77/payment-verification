Telebirr Payment Verifier

This is a simple API that verifies telebirr payments.

## API Endpoints

- `GET /verify/:reference` - Verifies a payment with the given reference.

## Usage

```bash
# Install dependencies
npm install

# Run the server
npm run start:dev
```

## Environment Variables

- `PORT` - The port to run the server on (default: 3000)
- `TELEBIRR_API_URL` - The URL of the telebirr API (default: https://api.telebirr.com/verify)
- `TELEBIRR_API_KEY` - The API key for the telebirr API (default: your_api_key_here)
- `TELEBIRR_API_SECRET` - The API secret for the telebirr API (default: your_api_secret_here)

## License

MIT