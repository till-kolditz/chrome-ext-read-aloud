# chrome-ext-read-aloud
A chrome extension which reads aloud the main body of a web page.

# Generating Prompts
In the age of AI, IMHO it's important now to document the actual prompts which generated the contents. This text is written by hand, though ;-) I used ChatGPT 5.2 to generate most if not all of this project's contents. Following is the prompt history:

* Generate a chrome extension which can read out the body text of the current web page that is opened in chrome. It should ignore all menus and read out only the text of the main body of the web page.
* Add a voice dropdown and pause/resume functionality. To guide you, as an example, the extension should be able to read these web pages:
    * https://www.checkpoint.com/de/press-releases/check-point-acquires-lakera-to-deliver-end-to-end-ai-security-for-enterprises/ -- Here the main body text starts with "Check Point Press Releases" and ends with the paragraph about "Legal Notice Regarding Forward-Looking Statements".
    * https://www.phoronix.com/news/Linus-Torvalds-Too-Many-LSM -- Here the main body starts at "Torvalds On Linux Security Modules:" and ends with the paragraph about "Popular News This Week".
* Remove the explicit markers for the webpages, since this is just overfitting.
* Generate an icon with an abstract person's face from the side with an open mouth, such as if the person was saying "ah" at the moment.
* Make the image an svg, reduce the space around the face and use the image as the extension's icon.
* Make the icon's background transparent, but keep the are inside the head white.
* Add a thin white line around the whole head and the three orange lines.
* From this icon, generate the icon sizes used for the chrome extensions.
* Make the chrome extension detect the web page's language.
* Show the detected language on the popup and auto-select a matching voice.
* Tweak it so the dropdown remains on “Auto” while still using the detected language each time.

# Folder Structure
* read-main-body-aloud/
  * manifest.json
  * popup.html
  * popup.js
  * background.js
  * content.js
  * readability.js
  * icons/
    * icon16.png
    * icon32.png
    * icon48.png
    * icon128.png

# Readability library
The "library" (i.e. the single JavaScript file) was downloaded from GitHub at https://raw.githubusercontent.com/mozilla/readability/refs/heads/main/Readability.js on December 16, 2025, commit ID [08be6b4bdb204dd333c9b7a0cfbc0e730b257252](https://github.com/mozilla/readability/commit/08be6b4bdb204dd333c9b7a0cfbc0e730b257252).

# Install & test

1. Put the files in a folder: read-aloud/
1. Chrome → chrome://extensions
1. Enable Developer mode
1. Load unpacked → select the folder
1. Open an article page → click the extension icon → Read main body