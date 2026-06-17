# Rate Limits

* * *

The Image Chest API currently allows 60 requests per minute. This is to ensure that a single user is unable to spam the application.

Each request contains rate limit information in the response headers.

| Header | Description |
| --- | --- |
| X-RateLimit-Limit | Number of times the API can be accessed in a given time |
| X-RateLimit-Remaining | Number of calls remaining |
