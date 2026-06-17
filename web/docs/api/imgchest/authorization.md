# Authorization

* * *

To access any endpoint of the Image Chest API, you must be authorized. You can solve this by using bearer authentication, also known as token authentication. Image Chest allows the creation or deletion of these personal access tokens from your profile under the **security** tab.

### How To Generate A Token

Log in to Image Chest and navigate to the security tab in your profile.

The **Personal Access Tokens** section here will allow you to see all of your generated tokens, add new tokens, or delete existing tokens.

To generate a new token, click on the **New Token** button in the corner of this section.
A window will pop up asking you to name your token. We recommend descriptive names in case you need to revoke access later.
Once you have entered a name, you can click the create button.

Once the token is created a new window will open showing you your generated personal access token. Make sure that you get this token saved before closing the window as it will not be displayed again.

Use this token in the header of any of your requests to authorize yourself.

| Key | Value |
| --- | --- |
| Authorization | Bearer Token |
