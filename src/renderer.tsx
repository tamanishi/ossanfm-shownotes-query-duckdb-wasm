import { jsxRenderer } from 'hono/jsx-renderer'

declare module 'hono' {
    interface ContextRenderer {
        (content: string | Promise<string>, props?: { title?: string }): Response
    }
}

export const renderer = jsxRenderer(
    ({ children, title }) => {
        return (
            <html>
                <head>
                    <title>{title}</title>
                    {import.meta.env.PROD ? (
                        <>
                        <link href="/static/style.css" rel="stylesheet" />
                        <script type="module" src="/static/client.js" />
                        </>
                    ) : (
                        <>
                        <script type="module" src="/src/client.ts" />
                        <link href="/src/style.css" rel="stylesheet" />
                        </>
                    )}
                </head>
                <body>
                    {children}
                    <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "617493207c814f5290d56db41d569c91"}'></script>
                </body>
            </html>
        )
    },
    {
        docType: true
    }
)
