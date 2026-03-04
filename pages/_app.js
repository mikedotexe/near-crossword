import { useEffect } from "react";
import Head from "next/head";
import Script from "next/script";
import { useRouter } from "next/router";
import { ThemeProvider } from "next-themes";
import "../src/css/normalize.css";
import "../src/css/main.css";
import "../src/App.css";
import { AppFlowProvider } from "../src/lib/appFlow";
import { trackPageView } from "../src/lib/analytics";

const RouteAnalytics = () => {
  const router = useRouter();

  useEffect(() => {
    const handleRouteChange = (url) => {
      trackPageView(url);
    };

    handleRouteChange(router.asPath);
    router.events.on("routeChangeComplete", handleRouteChange);
    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, [router]);

  return null;
};

export default function RootApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>NEAR Crossword Campaigns</title>
        <meta
          name="description"
          content="Create and solve on-chain crossword quiz campaigns on NEAR."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-W7388GB8Q3"
        strategy="afterInteractive"
        onLoad={() => {
          trackPageView(window.location.pathname + window.location.search);
        }}
      />
      <Script id="ga-setup" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', 'G-W7388GB8Q3');
        `}
      </Script>

      <ThemeProvider attribute="class" defaultTheme="light">
        <AppFlowProvider>
          <RouteAnalytics />
          <Component {...pageProps} />
        </AppFlowProvider>
      </ThemeProvider>
    </>
  );
}
