Using the following MKdocs extensions can enhance your TechDocs, making the user experience richer and more appealing for the reader. These samples were developed based on the reference documentation [here](https://squidfunk.github.io/mkdocs-material/reference/). View the source code of this page to discover the correct markup to use for each item displayed below.

## Quotes

!!! quote "This is a quote"
    You don't have to add a title to a quote, they're optional.

## Callouts (Admonitions)

There are lots of types to choose from. You don't have to add a title to an admonition, they're optional. See [here](https://squidfunk.github.io/mkdocs-material/reference/admonitions/).

!!! info "This is an Info Card"
    There are lots of types to choose from. See [here](https://squidfunk.github.io/mkdocs-material/reference/admonitions/).

!!! warning "This is a Warning Card"
    This callout contains a warning.

!!! note "This is a Note Card"
    This callout contains a note.

???+ question "This Question Can Be Contracted"
    This is expanded by default (but can be contracted).

??? tip "This Tip is Contracted (By Default)"
    This is contracted by default (but can be expanded).

## Content Tabs

Particularly useful for code blocks for different programming languages or platforms, but could have many other users.

=== "Mac OS & Linux"

    ```bash
    # Extract the tar archive into your ~/downloads directory
    tar -xvf my-bundle.tar -C ./downloads
    ```

=== "Windows"

    ```powershell
    # Extract the zip
    Expand-Archive .\my-bundle.zip
    ```

=== "Text"

    You can have what you like in here, just like an admonition. It doesn't *have* to be code blocks :smile:.

## Buttons

[Subscribe to our newsletter](#){ .md-button }

!!! note "More diagrams and examples"
    You can find much more information about PlantUML and samples to try on their [website](https://plantuml.com/). Use the links at th top of the page for samples.

## Footnotes

Lorem ipsum[^1] dolor sit amet, consectetur adipiscing elit.[^2]

[^1]: Lorem ipsum dolor sit amet, consectetur adipiscing elit.

[^2]:
    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla et euismod nulla. Curabitur feugiat, tortor non consequat finibus, justo purus auctor massa, nec semper lorem quam in massa.

## Text Formatting

Text can be {--deleted--} and replacement text {++added++}. This can also be combined into {~~one~>a single~~} operation. {==Highlighting==} is also
possible {>>and comments can be added inline<<}.

{==

Formatting can also be applied to blocks by putting the opening and closing
tags on separate lines and adding new lines between the tags and the content.

==}

- ==This was marked==
- ^^This was inserted^^
- ~~This was deleted~~

- Subtext H~2~O
- Supertext A^T^A

## Task Lists

Automatic rendering of Markdown task lists.

- [x] Phase 1
- [x] Phase 2
- [ ] Phase 3

## Emoji

:smile: You can use Emoji's in your writing! Find the shortcodes [here](https://emojipedia.org/) :heart:.

## Images

You can align and resize images.

=== "Image LEFT"

    ![Image title](https://dummyimage.com/600x400/eee/aaa){ align=left }

=== "Image RIGHT"

    ![Image title](https://dummyimage.com/600x400/eee/aaa){ align=right }

=== "Image RESIZE"

    ![Image title](https://dummyimage.com/600x400/eee/aaa){ align=right width="200" }

You can add captions to your images.

<figure markdown>
  ![Image title](https://dummyimage.com/600x400/){ width="300" }
  <figcaption>This image now has a caption.</figcaption>
</figure>

## Special Lists

Below is a "definition list." Notice the indentation...

`Lorem ipsum dolor sit amet`

:   Sed sagittis eleifend rutrum. Donec vitae suscipit est. Nullam tempus
    tellus non sem sollicitudin, quis rutrum leo facilisis.

`Cras arcu libero`

:   Aliquam metus eros, pretium sed nulla venenatis, faucibus auctor ex. Proin
    ut eros sed sapien ullamcorper consequat. Nunc ligula ante.

    Duis mollis est eget nibh volutpat, fermentum aliquet dui mollis.
    Nam vulputate tincidunt fringilla.
    Nullam dignissim ultrices urna non auctor.

Below is a task list, with done and not done items...

- [x] Lorem ipsum dolor sit amet, consectetur adipiscing elit
- [ ] Vestibulum convallis sit amet nisi a tincidunt
- [ ] Aenean pretium efficitur erat, donec pharetra, ligula non scelerisque


## MDX truly sane lists

- `attributes`

- `customer`
  - `first_name`
    - `test`
  - `family_name`
  - `email`
- `person`
  - `first_name`
  - `family_name`
  - `birth_date`
- `subscription_id`

- `request`

## Tool tips

Links can have tool tips.

[Link with tool tip](https://example.com "I'm a tooltip!")

Link with tooltip (using the separate 'reference' syntax).

[Hover me][example]

[example]: https://example.com "I'm a tooltip!"


## Download Links

[A Download Link](./images/backstage-logo-cncf.svg){: download }


## Abbreviations & Acronyms

Define an abbreviation once and wherever it appears on the page it will be underlined. Hover over the underlined abbreviation and the expanded abbreviation is shown as a tool tip. No more wondering what "CNCF" stands for!

*[CNCF]: Cloud Native Compting Foundation