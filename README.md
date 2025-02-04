# linkedin-job-search-server

## Description

This is an MCP server that provides a tool for searching jobs on LinkedIn using natural language. The tool, `chat_linkedin_jobs`, allows users to input a natural language query, which is then used to scrape job listings from LinkedIn.

## Requirements

*   The tool should provide a chatbot-like conversational experience for job searching.
*   The tool should intelligently search LinkedIn based on natural language input, extracting keywords, location, and other relevant criteria.
*   The tool should be able to ask clarifying questions if the user's input is ambiguous.
*   The tool should present a list of relevant job postings from LinkedIn.
*   The tool should be implemented as an MCP server.

## Approach and Architecture

The `linkedin-job-search-server` is implemented as a Node.js application using the `@modelcontextprotocol/sdk` to create an MCP server. The server exposes a single tool, `chat_linkedin_jobs`, which handles the job search functionality.

The current implementation uses web scraping to fetch job listings from LinkedIn. It utilizes the `axios` library to make HTTP requests and the `cheerio` library to parse the HTML content of LinkedIn job search pages.

The tool currently has a basic caching mechanism to reduce the number of requests made to LinkedIn and avoid rate limiting.

## Dependencies

*   `@modelcontextprotocol/sdk`: The Model Context Protocol SDK for creating MCP servers.
*   `axios`: For making HTTP requests to LinkedIn.
*   `cheerio`: For parsing HTML content and extracting job listing information.
*   `compromise`: For basic natural language processing (currently not fully utilized).
*   `random-useragent`: To generate random user agents for web scraping.
*   `typescript`: For type checking and better code maintainability.

## Usage

To use the `chat_linkedin_jobs` tool, you can send a request to the MCP server with the following format:

```xml
<use_mcp_tool>
<server_name>linkedin-job-search-server</server_name>
<tool_name>chat_linkedin_jobs</tool_name>
<arguments>
{
  "query": "your job search query here"
}
</arguments>
</use_mcp_tool>
```

Replace `"your job search query here"` with your desired job search query, such as "software engineer jobs in London".

## Limitations

*   The current implementation uses a placeholder for natural language processing and simply returns the user's query.
*   The web scraping approach is brittle and may break if LinkedIn changes its website structure.
*   There is no authentication implemented, so the tool can only access publicly available job listings.
*   The tool may encounter rate limits from LinkedIn if too many requests are made in a short period.
*   There is no integration with the user's CV or LinkedIn profile to personalize search results.

## Future Enhancements

*   Implement more sophisticated natural language processing using `compromise` or other NLP libraries to better understand user queries and extract relevant search parameters.
*   Improve the web scraping logic to handle various search filters and extract more detailed job information.
*   Implement proper authentication with the LinkedIn API (if possible) to access more features and potentially avoid rate limiting.
*   Add more robust error handling and rate limit management.
*   Integrate with the user's CV and LinkedIn profile to personalize search results.
*   Add the ability to assist with job applications.

## Build and Run

To build and run the server, use the following commands:

```bash
npm install
npm run build
```

This will install the dependencies, compile the TypeScript code, and make the server executable. The server will then be accessible through the MCP client.
