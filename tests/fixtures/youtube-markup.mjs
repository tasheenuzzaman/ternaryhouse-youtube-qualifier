/**
 * SIMULATED YouTube channel-page markup for tests.
 *
 * NOT captured from live YouTube. These builders reconstruct the general
 * shape of YouTube's channel Videos page — the modern lockup view-model card,
 * the legacy ytd-rich-grid-media and ytd-grid-video-renderer cards, the modern
 * and legacy channel headers, the sort chips — from the selectors the
 * extension already relies on (verified live in v1.1.0) and from public
 * knowledge of YouTube's markup. Status strings ("Premieres ...", "Notify me",
 * "N waiting", "LIVE", "N watching", "3 days ago") follow YouTube's English UI
 * as recorded in the v1.2 brief's operator screenshots.
 *
 * They exercise the readers' logic. They do not prove what today's YouTube
 * serves; that requires the live checks listed in RELEASE_NOTES_v1.2.0.md.
 */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Metadata presets for the common publication states. */
export const STATUS = Object.freeze({
  published: { badge: '10:15', meta: ['12K views', '3 days ago'] },
  short058: { badge: '0:58', meta: ['3.1K views', '4 days ago'] },
  completedPremiere: { badge: '24:03', meta: ['48K views', 'Premiered 5 days ago'] },
  completedStream: { badge: '1:02:03', meta: ['9K views', 'Streamed 6 days ago'] },
  scheduled: { badge: 'UPCOMING', meta: ['12 waiting', 'Premieres 10/11/26, 8:00 PM'], button: 'Notify me' },
  scheduledTextOnly: { badge: null, meta: ['Premieres 10/12/26, 7:30 PM'] },
  scheduledButtonOnly: { badge: null, meta: [], button: 'Notify me' },
  live: { badge: 'LIVE', meta: ['1.2K watching'] },
  noStatus: { badge: '10:15', meta: ['12K views'] },
  conflicting: { badge: '10:15', meta: ['12K views', '3 days ago'], button: 'Notify me' },
});

function age(daysAgo) {
  if (daysAgo < 1) return '5 hours ago';
  if (daysAgo < 7) return `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
  if (daysAgo < 30) return `${Math.floor(daysAgo / 7)} week${daysAgo < 14 ? '' : 's'} ago`;
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30)} month${daysAgo < 60 ? '' : 's'} ago`;
  return `${Math.floor(daysAgo / 365)} year${daysAgo < 730 ? '' : 's'} ago`;
}

/** A published card `daysAgo` old. */
export const publishedAt = (daysAgo) => ({ badge: '10:15', meta: ['12K views', age(daysAgo)] });

/**
 * The modern lockup card inside ytd-rich-item-renderer.
 *
 * opts: id, title, visibleTitle, titleAttr (default true), badge, meta[],
 *       button (text), buttonAriaOnly, titleHref, extraHtml, hrefSuffix
 */
export function modernCard(opts) {
  const o = { ...STATUS.published, titleAttr: true, ...opts };
  const href = `/watch?v=${o.id}${o.hrefSuffix || ''}`;
  const titleHref = o.titleHref || href;
  const visible = o.visibleTitle ?? o.title;
  const badge = o.badge === null ? '' : `
            <yt-thumbnail-overlay-badge-view-model class="ytThumbnailOverlayBadgeViewModelHost">
              <yt-thumbnail-badge-view-model class="ytThumbnailBadgeViewModelHost">
                <badge-shape class="ytBadgeShapeHost ytBadgeShapeThumbnailDefault" role="img"><div class="ytBadgeShapeText">${esc(o.badge)}</div></badge-shape>
              </yt-thumbnail-badge-view-model>
            </yt-thumbnail-overlay-badge-view-model>`;
  const meta = (o.meta || []).map((m, i) => `${i ? '<span class="ytContentMetadataViewModelDelimiter" aria-hidden="true"> • </span>' : ''}<span class="yt-core-attributed-string ytContentMetadataViewModelMetadataText" role="text">${esc(m)}</span>`).join('');
  const button = !o.button ? '' : `
              <button-view-model class="ytSpecButtonViewModelHost"><button class="yt-spec-button-shape-next" aria-label="${esc(o.button)}">${o.buttonAriaOnly ? '<div class="yt-spec-button-shape-next__icon"></div>' : `<div class="yt-spec-button-shape-next__button-text-content">${esc(o.button)}</div>`}</button></button-view-model>`;
  return `
<ytd-rich-item-renderer class="style-scope ytd-rich-grid-renderer" lockup="true" rendered-from-rich-grid="">
  <div id="content" class="style-scope ytd-rich-item-renderer">
    <yt-lockup-view-model class="ytd-rich-item-renderer lockup">
      <div class="yt-lockup-view-model yt-lockup-view-model--vertical content-id-${o.id}">
        <a href="${esc(href)}" class="yt-lockup-view-model__content-image" aria-hidden="true" tabindex="-1">
          <yt-thumbnail-view-model class="ytThumbnailViewModelHost">
            <div class="ytThumbnailViewModelImage"><img alt="" src="https://i.ytimg.com/vi/${o.id}/hqdefault.jpg"></div>${badge}
          </yt-thumbnail-view-model>
        </a>
        <div class="yt-lockup-view-model__metadata">
          <yt-lockup-metadata-view-model class="ytLockupMetadataViewModelHost">
            <div class="ytLockupMetadataViewModelTextContainer">
              <h3 class="ytLockupMetadataViewModelHeadingReset"${o.titleAttr ? ` title="${esc(o.title)}"` : ''}>
                <a href="${esc(titleHref)}" class="ytLockupMetadataViewModelTitle"><span class="yt-core-attributed-string" role="text">${esc(visible)}</span></a>
              </h3>
              <div class="ytLockupMetadataViewModelMetadata">
                <yt-content-metadata-view-model class="ytContentMetadataViewModelHost">
                  <div class="ytContentMetadataViewModelMetadataRow">${meta}</div>
                </yt-content-metadata-view-model>
              </div>${button}
            </div>
            <div class="ytLockupMetadataViewModelMenuButton"><button-view-model><button class="yt-spec-button-shape-next" aria-label="More actions"><div class="yt-spec-button-shape-next__icon"></div></button></button-view-model></div>
          </yt-lockup-metadata-view-model>
        </div>${o.extraHtml || ''}
      </div>
    </yt-lockup-view-model>
  </div>
</ytd-rich-item-renderer>`;
}

/** The legacy Polymer ytd-rich-grid-media card inside ytd-rich-item-renderer. */
export function legacyRichCard(opts) {
  const o = { ...STATUS.published, titleAttr: true, ...opts };
  const href = `/watch?v=${o.id}${o.hrefSuffix || ''}`;
  const overlayStyle = o.badge === 'LIVE' ? 'LIVE' : o.badge === 'UPCOMING' ? 'UPCOMING' : 'DEFAULT';
  const overlay = o.badge === null ? '' : `
                <ytd-thumbnail-overlay-time-status-renderer class="style-scope ytd-thumbnail" overlay-style="${overlayStyle}">
                  <div id="time-status" class="style-scope ytd-thumbnail-overlay-time-status-renderer">
                    <yt-icon size="16" class="style-scope ytd-thumbnail-overlay-time-status-renderer" hidden=""></yt-icon>
                    <span id="text" class="style-scope ytd-thumbnail-overlay-time-status-renderer">
                      ${esc(o.badge)}
                    </span>
                  </div>
                </ytd-thumbnail-overlay-time-status-renderer>`;
  const meta = (o.meta || []).map((m) => `<span class="inline-metadata-item style-scope ytd-video-meta-block">${esc(m)}</span>`).join('\n                  ');
  const button = !o.button ? '' : `
            <div id="buttons" class="style-scope ytd-rich-grid-media"><ytd-toggle-button-renderer class="style-scope ytd-rich-grid-media"><yt-button-shape><button class="yt-spec-button-shape-next" aria-label="${esc(o.button)}"><div class="yt-spec-button-shape-next__button-text-content"><span class="yt-core-attributed-string" role="text">${esc(o.button)}</span></div></button></yt-button-shape></ytd-toggle-button-renderer></div>`;
  return `
<ytd-rich-item-renderer class="style-scope ytd-rich-grid-renderer">
  <div id="content" class="style-scope ytd-rich-item-renderer">
    <ytd-rich-grid-media class="style-scope ytd-rich-item-renderer">
      <div id="dismissible" class="style-scope ytd-rich-grid-media">
        <div id="thumbnail" class="style-scope ytd-rich-grid-media">
          <ytd-thumbnail class="style-scope ytd-rich-grid-media" size="large">
            <a id="thumbnail" class="yt-simple-endpoint inline-block style-scope ytd-thumbnail" aria-hidden="true" tabindex="-1" href="${esc(href)}">
              <yt-image class="style-scope ytd-thumbnail"><img class="yt-core-image" alt="" src="https://i.ytimg.com/vi/${o.id}/hqdefault.jpg"></yt-image>
              <div id="overlays" class="style-scope ytd-thumbnail">${overlay}
                <ytd-thumbnail-overlay-now-playing-renderer class="style-scope ytd-thumbnail"><span id="overlay-text" class="style-scope ytd-thumbnail-overlay-now-playing-renderer">Now playing</span></ytd-thumbnail-overlay-now-playing-renderer>
              </div>
            </a>
          </ytd-thumbnail>
        </div>
        <div id="details" class="style-scope ytd-rich-grid-media">
          <div id="meta" class="style-scope ytd-rich-grid-media">
            <h3 class="style-scope ytd-rich-grid-media">
              <ytd-badge-supported-renderer class="top-badge style-scope ytd-rich-grid-media" hidden=""></ytd-badge-supported-renderer>
              <a id="video-title-link" class="yt-simple-endpoint focus-on-expand style-scope ytd-rich-grid-media" aria-label="${esc(o.title)} 12,000 views 3 days ago"${o.titleAttr ? ` title="${esc(o.title)}"` : ''} href="${esc(href)}">
                <yt-formatted-string id="video-title" class="style-scope ytd-rich-grid-media">${esc(o.visibleTitle ?? o.title)}</yt-formatted-string>
              </a>
            </h3>
            <ytd-video-meta-block class="grid style-scope ytd-rich-grid-media byline-separated">
              <div id="metadata" class="style-scope ytd-video-meta-block">
                <div id="byline-container" class="style-scope ytd-video-meta-block" hidden="">
                  <ytd-channel-name class="style-scope ytd-video-meta-block"><yt-formatted-string id="text">Premieres Weekly</yt-formatted-string></ytd-channel-name>
                </div>
                <div id="metadata-line" class="style-scope ytd-video-meta-block">
                  ${meta}
                </div>
              </div>
            </ytd-video-meta-block>${button}
          </div>
          <div id="menu" class="style-scope ytd-rich-grid-media"><ytd-menu-renderer class="style-scope ytd-rich-grid-media"><yt-icon-button id="button"><button id="button" aria-label="Action menu"></button></yt-icon-button></ytd-menu-renderer></div>
        </div>
      </div>
    </ytd-rich-grid-media>
  </div>
</ytd-rich-item-renderer>`;
}

/** The older ytd-grid-video-renderer card. */
export function legacyGridCard(opts) {
  const o = { ...STATUS.published, titleAttr: true, ...opts };
  const href = `/watch?v=${o.id}`;
  const meta = (o.meta || []).map((m) => `<span class="style-scope ytd-grid-video-renderer">${esc(m)}</span>`).join('');
  return `
<ytd-grid-video-renderer class="style-scope ytd-grid-renderer">
  <div id="dismissible" class="style-scope ytd-grid-video-renderer">
    <ytd-thumbnail class="style-scope ytd-grid-video-renderer"><a id="thumbnail" class="yt-simple-endpoint" href="${esc(href)}"><img alt=""><div id="overlays">${o.badge === null ? '' : `<ytd-thumbnail-overlay-time-status-renderer overlay-style="DEFAULT"><span id="text">${esc(o.badge)}</span></ytd-thumbnail-overlay-time-status-renderer>`}</div></a></ytd-thumbnail>
    <div id="details" class="style-scope ytd-grid-video-renderer">
      <div id="meta" class="style-scope ytd-grid-video-renderer">
        <h3 class="style-scope ytd-grid-video-renderer"><a id="video-title" class="yt-simple-endpoint style-scope ytd-grid-video-renderer"${o.titleAttr ? ` title="${esc(o.title)}"` : ''} href="${esc(href)}">${esc(o.visibleTitle ?? o.title)}</a></h3>
        <div id="metadata-container"><div id="metadata"><div id="metadata-line">${meta}</div></div></div>
      </div>
    </div>
  </div>
</ytd-grid-video-renderer>`;
}

/** A Shorts item as it can appear in a rich grid. */
export function shortsCard({ id }) {
  return `
<ytd-rich-item-renderer class="style-scope ytd-rich-grid-renderer">
  <div id="content"><ytm-shorts-lockup-view-model><a href="/shorts/${id}" class="shortsLockupViewModelHostEndpoint"><img alt=""></a><h3><a href="/shorts/${id}"><span>A Short</span></a></h3><span>1M views</span></ytm-shorts-lockup-view-model></div>
</ytd-rich-item-renderer>`;
}

/** A rich item whose content has not been stamped yet. */
export function unrenderedCard() {
  return `
<ytd-rich-item-renderer class="style-scope ytd-rich-grid-renderer">
  <div id="content" class="style-scope ytd-rich-item-renderer"><yt-lockup-view-model class="ytd-rich-item-renderer lockup"><div class="yt-lockup-view-model"><a class="yt-lockup-view-model__content-image"></a></div></yt-lockup-view-model></div>
</ytd-rich-item-renderer>`;
}

/** A rich item that links only to a playlist (not a video). */
export function playlistCard({ list = 'PLxxxxxxxxxxxxxxxx' } = {}) {
  return `
<ytd-rich-item-renderer class="style-scope ytd-rich-grid-renderer">
  <div id="content"><yt-lockup-view-model><a href="/playlist?list=${list}"><img alt=""></a><h3 title="A playlist"><a href="/playlist?list=${list}"><span>A playlist</span></a></h3></yt-lockup-view-model></div>
</ytd-rich-item-renderer>`;
}

export function grid(cardsHtml) {
  return `<ytd-rich-grid-renderer class="style-scope ytd-two-column-browse-results-renderer"><div id="contents" class="style-scope ytd-rich-grid-renderer">${cardsHtml}</div><ytd-continuation-item-renderer class="style-scope ytd-rich-grid-renderer"></ytd-continuation-item-renderer></ytd-rich-grid-renderer>`;
}

/**
 * The modern channel header.
 * opts: name, handle (with @), subscribers, videoCount, description (may
 *       contain \n), descriptionInButton (default true), extraRows[]
 */
export function modernHeader(o) {
  const descLines = o.description == null ? null : String(o.description).split('\n').map(esc).join('<br>');
  const descInner = descLines === null ? '' : `
          <yt-description-preview-view-model class="ytPageHeaderViewModelDescription">
            <truncated-text class="ytTruncatedTextHost">${o.descriptionInButton === false
    ? `<span class="yt-core-attributed-string" role="text">${descLines}</span>`
    : `<button class="ytTruncatedTextTruncatedTextContent" aria-label="Description. tap for more"><span class="yt-core-attributed-string" role="text">${descLines}</span></button>`}<button class="ytTruncatedTextAbsoluteButton" aria-label="tap for more">...more</button></truncated-text>
          </yt-description-preview-view-model>`;
  const counts = [o.subscribers, o.videoCount].filter(Boolean)
    .map((t, i) => `${i ? '<span class="ytContentMetadataViewModelDelimiter" aria-hidden="true"> • </span>' : ''}<span class="yt-core-attributed-string" role="text">${esc(t)}</span>`).join('');
  return `
<yt-page-header-renderer class="style-scope ytd-tabbed-page-header">
  <yt-page-header-view-model class="ytPageHeaderViewModelHost">
    <div class="ytPageHeaderViewModelPageHeaderHeadline">
      <yt-decorated-avatar-view-model><img alt=""></yt-decorated-avatar-view-model>
      <div class="ytPageHeaderViewModelPageHeaderHeadlineInfo page-header-view-model-wiz__page-header-headline-info">
        <yt-dynamic-text-view-model class="ytPageHeaderViewModelDynamicTextViewModel">
          ${o.name == null ? '' : `<h1 class="dynamicTextViewModelH1"><span class="yt-core-attributed-string" role="text">${esc(o.name)}</span></h1>`}
        </yt-dynamic-text-view-model>
        <yt-content-metadata-view-model class="ytPageHeaderViewModelContentMetadata">
          ${o.handle ? `<div class="ytContentMetadataViewModelMetadataRow"><span class="yt-core-attributed-string" role="text">${esc(o.handle)}</span></div>` : ''}
          ${counts ? `<div class="ytContentMetadataViewModelMetadataRow">${counts}</div>` : ''}
        </yt-content-metadata-view-model>${descInner}
        <yt-flexible-actions-view-model class="ytFlexibleActionsViewModelHost">
          <div class="ytFlexibleActionsViewModelAction"><button-view-model><button class="yt-spec-button-shape-next" aria-label="Subscribe to ${esc(o.name || '')}.">Subscribe</button></button-view-model></div>
        </yt-flexible-actions-view-model>
      </div>
    </div>
  </yt-page-header-view-model>
</yt-page-header-renderer>`;
}

/** The legacy C4 channel header. */
export function legacyHeader(o) {
  return `
<ytd-c4-tabbed-header-renderer class="style-scope ytd-browse">
  <div id="channel-container"><div id="channel-header"><div id="channel-header-container">
    <div id="inner-header-container">
      <div id="meta">
        <ytd-channel-name id="channel-name"><div id="container"><div id="text-container"><yt-formatted-string id="text" class="style-scope ytd-channel-name">${esc(o.name)}</yt-formatted-string></div></div></ytd-channel-name>
        ${o.handle ? `<yt-formatted-string id="channel-handle">${esc(o.handle)}</yt-formatted-string>` : ''}
        ${o.subscribers ? `<yt-formatted-string id="subscriber-count">${esc(o.subscribers)}</yt-formatted-string>` : ''}
      </div>
      <div id="buttons"><ytd-subscribe-button-renderer><button aria-label="Subscribe">Subscribe</button></ytd-subscribe-button-renderer></div>
    </div>
  </div></div></div>
</ytd-c4-tabbed-header-renderer>`;
}

/** The Latest / Popular / Oldest chips (view-model markup). */
export function sortChips(selected = 0, labels = ['Latest', 'Popular', 'Oldest']) {
  return `<chip-bar-view-model class="ytChipBarViewModelHost"><div role="tablist">${labels.map((l, i) => `<chip-view-model><button role="tab" aria-selected="${i === selected}" class="ytChipShapeButtonReset"><div class="ytChipShapeChip">${esc(l)}</div></button></chip-view-model>`).join('')}</div></chip-bar-view-model>`;
}

/** A whole channel Videos page body. */
export function channelPage({ header, cards, selectedSort = 0, sortLabels }) {
  return `<ytd-app><div id="content"><ytd-page-manager id="page-manager"><ytd-browse class="style-scope ytd-page-manager" page-subtype="channels" role="main">
  <ytd-tabbed-page-header class="style-scope ytd-browse"><div id="page-header-container"><div id="page-header">${header}</div></div></ytd-tabbed-page-header>
  <ytd-two-column-browse-results-renderer class="style-scope ytd-browse"><div id="primary">
    <div id="header">${sortChips(selectedSort, sortLabels)}</div>
    ${grid(cards)}
  </div></ytd-two-column-browse-results-renderer>
</ytd-browse></ytd-page-manager></div></ytd-app>`;
}
