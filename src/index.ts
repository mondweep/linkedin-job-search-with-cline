#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import compromise from 'compromise';
import * as cheerio from 'cheerio';
import * as randomUseragent from 'random-useragent';

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;

if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
  console.error("LinkedIn API credentials not found in environment variables.");
}

const server = new Server(
  {
    name: "linkedin-job-search-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {
        chat_linkedin_jobs: {
          name: "chat_linkedin_jobs",
          description: "Search for jobs on LinkedIn using natural language",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Natural language query for job search (e.g., 'software engineer jobs in London')",
              },
            },
            required: ["query"],
          },
        },
      },
      prompts: {},
    },
  }
);

interface JobData {
  position: string;
  company: string;
  location: string;
  date?: string;
  salary: string;
  jobUrl: string;
  companyLogo: string;
  agoTime: string;
}

interface QueryObject {
  host?: string;
  keyword?: string;
  location?: string;
  dateSincePosted?: string;
  jobType?: string;
  remoteFilter?: string;
  salary?: string;
  experienceLevel?: string;
  sortBy?: string;
  limit?: number;
  page?: number;
}

// Utility functions
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Cache implementation
class JobCache {
  private cache: Map<string, { data: JobData[]; timestamp: number }>;
  private TTL: number;

  constructor() {
    this.cache = new Map();
    this.TTL = 1000 * 60 * 60; // 1 hour
  }

  set(key: string, value: JobData[]): void {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  get(key: string): JobData[] | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  clear(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.TTL) {
        this.cache.delete(key);
      }
    }
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

const cache = new JobCache();

// Add interface for Query instance
interface QueryInstance extends QueryObject {
  url(start: number): string;
  getDateSincePosted(): string;
  getExperienceLevel(): string;
  getJobType(): string;
  getRemoteFilter(): string;
  getSalary(): string;
  getPage(): number;
  getJobs(): Promise<JobData[]>;
  fetchJobBatch(start: number): Promise<JobData[]>;
}

// Fix Query constructor
class Query implements QueryInstance {
  host: string;
  keyword: string;
  location: string;
  dateSincePosted: string;
  jobType: string;
  remoteFilter: string;
  salary: string;
  experienceLevel: string;
  sortBy: string;
  limit: number;
  page: number;

  constructor(queryObj: QueryObject) {
    this.host = queryObj.host || "www.linkedin.com";
    this.keyword = queryObj.keyword?.trim().replace(/\s+/g, "+") || "";
    this.location = queryObj.location?.trim().replace(/\s+/g, "+") || "";
    this.dateSincePosted = queryObj.dateSincePosted || "";
    this.jobType = queryObj.jobType || "";
    this.remoteFilter = queryObj.remoteFilter || "";
    this.salary = queryObj.salary || "";
    this.experienceLevel = queryObj.experienceLevel || "";
    this.sortBy = queryObj.sortBy || "";
    this.limit = Number(queryObj.limit) || 0;
    this.page = Number(queryObj.page) || 0;
  }

  // Query prototype methods
  getDateSincePosted(): string {
    const dateRange: Record<string, string> = {
      "past month": "r2592000",
      "past week": "r604800",
      "24hr": "r86400",
    };
    return dateRange[this.dateSincePosted.toLowerCase()] || "";
  };

  getExperienceLevel(): string {
    const experienceRange: Record<string, string> = {
      internship: "1",
      "entry level": "2",
      associate: "3",
      senior: "4",
      director: "5",
      executive: "6",
    };
    return experienceRange[this.experienceLevel.toLowerCase()] || "";
  };

  getJobType(): string {
    const jobTypeRange: Record<string, string> = {
      "full time": "F",
      "full-time": "F",
      "part time": "P",
      "part-time": "P",
      contract: "C",
      temporary: "T",
      volunteer: "V",
      internship: "I",
    };
    return jobTypeRange[this.jobType.toLowerCase()] || "";
  };

  getRemoteFilter(): string {
    const remoteFilterRange: Record<string, string> = {
      "on-site": "1",
      "on site": "1",
      remote: "2",
      hybrid: "3",
    };
    return remoteFilterRange[this.remoteFilter.toLowerCase()] || "";
  };

  getSalary(): string {
    const salaryRange: Record<string, string> = {
      40000: "1",
      60000: "2",
      80000: "3",
      100000: "4",
      120000: "5",
    };
    return salaryRange[this.salary] || "";
  };

  getPage(): number {
    return this.page * 25;
  };

  url(start: number): string {
    let query = `https://${this.host}/jobs-guest/jobs/api/seeMoreJobPostings/search?`;

    const params = new URLSearchParams();

    if (this.keyword) params.append("keywords", this.keyword);
    if (this.location) params.append("location", this.location);
    if (this.getDateSincePosted())
      params.append("f_TPR", this.getDateSincePosted());
    if (this.getSalary()) params.append("f_SB2", this.getSalary());
    if (this.getExperienceLevel())
      params.append("f_E", this.getExperienceLevel());
    if (this.getRemoteFilter()) params.append("f_WT", this.getRemoteFilter());
    if (this.getJobType()) params.append("f_JT", this.getJobType());

    params.append("start", (start + this.getPage()).toString());

    if (this.sortBy === "recent") params.append("sortBy", "DD");
    else if (this.sortBy === "relevant") params.append("sortBy", "R");

    return query + params.toString();
  };

  async getJobs(): Promise<JobData[]> {
    let allJobs: JobData[] = [];
    let start = 0;
    const BATCH_SIZE = 25;
    let hasMore = true;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    try {
      // Check cache first
      const cacheKey = this.url(0);
      const cachedJobs = cache.get(cacheKey);
      if (cachedJobs) {
        console.log("Returning cached results");
        return cachedJobs;
      }

      while (hasMore) {
        try {
          const jobs = await this.fetchJobBatch(start);

          if (!jobs || jobs.length === 0) {
            hasMore = false;
            break;
          }

          allJobs.push(...jobs);
          console.log(`Fetched ${jobs.length} jobs. Total: ${allJobs.length}`);

          if (this.limit && allJobs.length >= this.limit) {
            allJobs = allJobs.slice(0, this.limit);
            break;
          }

          // Reset error counter on successful fetch
          consecutiveErrors = 0;
          start += BATCH_SIZE;

          // Add reasonable delay between requests
          await delay(2000 + Math.random() * 1000);
        } catch (error: any) {
          consecutiveErrors++;
          console.error(
            `Error fetching batch (attempt ${consecutiveErrors}):`,
            error.message
          );

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.log("Max consecutive errors reached. Stopping.");
            break;
          }

          // Exponential backoff
          await delay(Math.pow(2, consecutiveErrors) * 1000);
        }
      }

      // Cache results if we got any
      if (allJobs.length > 0) {
        cache.set(this.url(0), allJobs);
      }

      return allJobs;
    } catch (error: any) {
      console.error("Fatal error in job fetching:", error);
      throw error;
    }
  };

  async fetchJobBatch(start: number): Promise<JobData[]> {
    const userAgent = randomUseragent.getRandom();
    const headers = {
      "User-Agent": userAgent,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://www.linkedin.com/jobs",
      "X-Requested-With": "XMLHttpRequest",
      Connection: "keep-alive",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    try {
      const response = await axios.get(this.url(start), {
        headers,
        validateStatus: (status: number) => status === 200,
        timeout: 10000,
      });

      return parseJobList(response.data);
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new Error("Rate limit reached");
      }
      throw error;
    }
  };
}

function parseJobList(jobData: string): JobData[] {
  try {
    const $ = cheerio.load(jobData);
    const jobs = $("li");

    return jobs
      .map((_index: number, element: cheerio.Element): JobData | null => {
        try {
          const job = $(element);
          const position = job.find(".base-search-card__title").text().trim();
          const company = job.find(".base-search-card__subtitle").text().trim();
          const location = job.find(".job-search-card__location").text().trim();
          const dateElement = job.find("time");
          const date = dateElement.attr("datetime");
          const salary = job
            .find(".job-search-card__salary-info")
            .text()
            .trim()
            .replace(/\s+/g, " ");
          const jobUrl = job.find(".base-card__full-link").attr("href");
          const companyLogo = job
            .find(".artdeco-entity-image")
            .attr("data-delayed-url");
          const agoTime = job.find(".job-search-card__listdate").text().trim();

          if (!position || !company) {
            return null;
          }

          return {
            position,
            company,
            location,
            date,
            salary: salary || "Not specified",
            jobUrl: jobUrl || "",
            companyLogo: companyLogo || "",
            agoTime: agoTime || "",
          };
        } catch (err: any) {
          console.warn(`Error parsing job:`, err);
          return null;
        }
      })
      .get()
      .filter((job): job is JobData => job !== null);
  } catch (error) {
    console.error("Error parsing job list:", error);
    return [];
  }
}

// Export with proper types
export const clearCache = (): void => cache.clear();
export const getCacheSize = (): number => cache.getCacheSize();

/**
 * Start the server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "chat_linkedin_jobs": {
      const query = request.params.arguments?.query;
      if (!query || typeof query !== "string") {
        throw new Error("Query is required and must be a string");
      }

      const queryObject: QueryObject = {
        keyword: query,
        location: "London",
        limit: 10,
      };

      try {
        const queryInstance = new Query(queryObject);
        const jobs = await queryInstance.getJobs();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(jobs, null, 2)
          }]
        };
      } catch (error: any) {
        console.error("Error fetching jobs:", error);
        throw new Error("Failed to fetch jobs");
      }
    }
    default:
      throw new Error("Unknown tool");
  }
});