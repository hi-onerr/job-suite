/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', '@neondatabase/serverless', '@prisma/adapter-neon'],
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
