import * as cheerio from "cheerio";
import { logger } from "../lib/logger";

export interface ScrapedProduct {
  url: string;
  title: string | null;
  description: string | null;
  rawText: string;
}

export async function scrapeProductPage(url: string): Promise<ScrapedProduct> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    logger.warn({ err, url }, "Failed to fetch product page");
    return { url, title: null, description: null, rawText: "" };
  }

  if (!response.ok) {
    logger.warn({ url, status: response.status }, "Product page non-OK");
    return { url, title: null, description: null, rawText: "" };
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  $("script,style,noscript,svg,iframe").remove();

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const metaDesc = $('meta[name="description"]').attr("content");

  const title = (ogTitle || $("title").first().text() || "").trim() || null;
  const description = (ogDesc || metaDesc || "").trim() || null;

  const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);

  return { url, title, description, rawText: bodyText };
}
