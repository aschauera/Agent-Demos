const originalTitel = document.title;

let ajaxPushStateDone = false;

const ajax = "ajax";

const fragSep = '&';

const paramWord = 'q', paramPage = 'pg', paramType = 't', paramPortal = 'po', paramMime = 'mi';

const paramSet = new Set([paramWord, paramPage, paramType, paramPortal, paramMime]);

function setSearchWord() {
	return function (value) {
		$("#search_words").val(decodeURIComponent(value));
		$("#search-top-text").val(decodeURIComponent(value));
	};
}

function setPageNo() {
	return function (value) {
		$("#search_site_page").val(value);
	};
}

function setSearchType() {
	return function (value) {
		$("#search_type").val(value);
	};
}

function setPortal() {
	return function (value) {
		$("#search_result_portal").val(value);
	};
}

function setMime() {
	return function (value) {
		$("#search_result_mimetype").val(value);
	};
}

const setFormFromParams = new Map([
	[paramWord, setSearchWord()],
	[paramPage, setPageNo()],
	[paramType, setSearchType()],
	[paramPortal, setPortal()],
	[paramMime, setMime()],
]);

const setHashFromForm = new Map([
	[paramWord, function () {return $("#search_words").val()}],
	[paramPage, function () {return $("#search_site_page").val()}],
	[paramType, function () {return $("#search_type").val()}],
	[paramPortal, function () {return $("#search_result_portal").val()}],
	[paramMime, function () {return $("#search_result_mimetype").val()}],
]);

const eqSet = (xs, ys) =>
	xs.size === ys.size &&
	[...xs].every((x) => ys.has(x));

function executeSearch() {
	let $searchForm = $("#searchform");
	const dataArray = $searchForm.serializeArray();
	$.ajax({
		url : $searchForm.attr("action"),
		type : "GET",
		data : dataArray,
		success : function(response) {
			$("#searchresult").html(response).show();
			$(".container-searchresult").show();
			let content = $("#content");
			content.hide();

			App.watchSearchFilter();
			content.attr("id", "content-off");
			$("#searchresult #resultList").attr("id", "content");

			trackSearchResultPage();
			let $searchMobileText = $("#search-mobile-text");
			$("#subnavigation").attr('style','display:none !important');
			$("#search-mobile-button").click(function() {
				$("#search_words").val($searchMobileText.val());
				$("#search_site_page").val(1);
				$("#search-top-text").val($searchMobileText.val());
				$("#mobileheader-wrapper").removeClass("show");
				executeSearchHtml();
			});
			if ($("#search_type").val() !== ajax) {
				document.getElementById("content").focus();
			}
		},
		error : function(jXHR, textStatus, errorThrown) {
			console.log(errorThrown);
		},
		complete: function(){
			document.querySelector('title').textContent = originalTitel + " - " + $("#searchresult .title").text();	
		}
	});
	gotoTop();
}

function setHistory() {
	const state = $("#searchform").html();

	let hash = '#';
	const arr = [];

	setHashFromForm.forEach((value, key) => {
		arr.push(String().concat(key).concat("=").concat(encodeAnchor(value())));
	})
	hash = hash.concat(arr.join(fragSep));

	let $searchWords = $("#search_words");
	if ($("#search_type").val() === ajax) {
		if (!ajaxPushStateDone || stateNeedsPush()) {
			history.pushState(state, 'Ajax-Suche nach "' + $searchWords.val() + '"', hash);
			ajaxPushStateDone = true;
		}
		history.replaceState(state, 'Ajax-Suche nach "' + $searchWords.val() + '"', hash);
	} else {
		history.pushState(state, 'Simple-Suche nach "' + $searchWords.val() + '"', hash);
		ajaxPushStateDone = false;
	}
}

function stateNeedsPush() {
	let domparser = new DOMParser();
	let historyState = domparser.parseFromString(history.state, 'text/html');
	historyState.getElementById("search_words").remove();

	let actState = domparser.parseFromString($("#searchform").html(), 'text/html');
	actState.getElementById("search_words").remove();

	return !(historyState.body.innerHTML === actState.body.innerHTML);
}

addEventListener("DOMContentLoaded", (event) =>  {
	if (document.location.hash) {
		let parameters = document.location.hash.replace('#', '').split(fragSep);
		const paramMap = new Map();

		parameters.forEach((param) => {
			[key, ...value] = param.split("=");
			let valStr = value.length > 0 ? value.join('=') : null;
			paramMap.set(key, valStr);
		});

		if (eqSet(paramSet, new Set(paramMap.keys()))) {
			paramMap.forEach((value, key) => {
				let fn = setFormFromParams.get(key);
				if (typeof fn === "function") {
					fn(value);
				}
			})
			executeSearch();
		}
	}
});

window.addEventListener('popstate', e => {
	const state = e.state;
	if (typeof state === "string") {
		$("#searchform").html(state);
		$("#search-top-text").val($("#search_words").val());
		executeSearch();
	}
} );
function updateSearchResult(state, data = '') {
	const searchResultDiv = document.getElementById("searchresult");
	if(!searchResultDiv) return;

	switch (state) {
		case 'loading':
			searchResultDiv.innerHTML = '<p>Ergenisse werden geladen...</p>';
			break;
		case 'success':
			searchResultDiv.innerHTML = data;
			break;
		case 'error':
			searchResultDiv.innerHTML = '<p>Ups, da ist etwas schief gegangen... </p>'
			break;
	}
}

// Funktion zum Zurücksetzen des Zustands (Suchleiste und Button)
function resetPageState() {
	// Toggle-Button zurücksetzen
	const toggleButton = document.querySelector('.btn.btn-link.search-top-toggler');
	if (toggleButton) {
		toggleButton.classList.add('collapsed'); // Button zurücksetzen
		toggleButton.ariaExpanded = 'false';
	}

	// Suchleiste ausblenden (Klasse "show" entfernen)
	const searchBar = document.getElementById('search-top-wrapper');
	if (searchBar && searchBar.classList.contains('show')) {
		searchBar.classList.remove('show'); // Klasse entfernen, um die Leiste auszublenden
	}

	// Searchresult ausblenden
	const searchResultDiv = document.getElementById('searchresult');
	if (searchResultDiv) {
		searchResultDiv.style.display = 'none';
	}

	// Content anzeigen und ID aktualisieren
	const contentOffDiv = document.getElementById('content-off');
	if (contentOffDiv) {
		contentOffDiv.id = 'content'; // ID ändern
		contentOffDiv.style.display = ''; // Sichtbar machen
	}
}

// Event-Listener für das Zurückgehen im Browser
window.addEventListener('popstate', () => {
	resetPageState(); // Zustand zurücksetzen
	updateSearchResult('loading');
});

function encodeAnchor(anchor) {
	return encodeURI(anchor)
		.replace(
			/[!'()*]/g,
			(l) => `%${l.charCodeAt(0).toString(16).toUpperCase()}`
		);
}
function executeSearchHtml() {
	$("#search_type").val("simple");
	executeSearch();
	setHistory();
}

function executeSearchHtmlWithEnter(event) {
	const keyCode = event.which || event.keyCode;
	if (keyCode === 13) {
		$("#search_words").val($("#search-top-text").val());
		if ( ($('#searchform_redirect').val()) != null ) {
    		$("#searchform_redirect").submit();
    	} else {
			$("#search_site_page").val(1);
			$("#search_type").val("simple");
			executeSearch();
			setHistory();
    	}
	}
}

function executeSearchAjax(event) {
	if ($(this).val().length >= 3) {
		$("#search_words").val($(this).val());
		$("#search_site_page").val(1);
		const keyCode = event.which || event.keyCode;
		if (keyCode === 13) {
			$("#search_type").val("simple");
			executeSearch();
			setHistory();
		} else {
			$("#search_type").val(ajax);
			executeSearch();
			setHistory();
		}
	} else {
		hideSearchPage();
	}
}

function executeSearchPage(pagenr) {
	$("#search_site_page").val(pagenr);
	executeSearch();
	setHistory();
}

function gotoTop(){
	$('html, body').animate({
        scrollTop: $("#page-bottom").offset().top - 300
    }, 500);
}

function hideSearchPage() {
	$("#searchresult").hide();
	$(".container-searchresult").hide();
		
	document.querySelector('title').textContent = originalTitel;
	
	$("#searchresult #content").attr("id", "resultList");
	$("#content-off").attr("id", "content");
	
	$("#content").show();
	$("#subnavigation").show();
}

function trackSearchResultPage() {
	if ($("#search_type").val()!=="simple" || $("#search_trackSearchResultPages").val()!=="true") {
		return;
	}
	if (typeof _etracker != 'object') {
		return;
	}
	const secureCode = $("#_etLoader").data("secure-code");
	if (typeof secureCode == 'undefined') {
		return;
	}

	const totalElements = parseInt($("div.searchresult-teaser").data("total-elements"));
	let cmp = "ohne Ergebnis";
	if (totalElements > 0) {
		cmp = "mit Ergebnis";
	}

	cc_attributes = {};
	cc_attributes["etcc_cu"] = "onsite";
	cc_attributes["etcc_med_onsite"] = "Interne Suche";
	cc_attributes["etcc_cmp_onsite"] = cmp;
	cc_attributes["etcc_st_onsite"] = $("#search_words").val();
	et_eC_Wrapper(secureCode, '', '', '',);
}

$("#search-top-text[data-ajaxEnabled='true']").keyup(executeSearchAjax);
$("#search-top-text[data-ajaxEnabled='false']").keyup(executeSearchHtmlWithEnter);
$("#search-top-button").click(function() {
	$("#search_words").val($("#search-top-text").val());
	executeSearchHtml();
});
$("#search-mobile-button").click(function() {
	let $searchWords = $("#search_words");
	let $searchTopText = $("#search-top-text");
	let $searchMobileText = $("#search-mobile-text");
	let $mobileheaderWrapper = $("#mobileheader-wrapper");
	$searchWords.val($searchTopText.val());
	$searchWords.val($searchMobileText.val());
	$("#search_site_page").val(1);
	$searchTopText.val($searchMobileText.val());
	$mobileheaderWrapper.removeClass("show");
	$mobileheaderWrapper.removeClass("collapsing-show");
	$("#mobilenav-toggler").attr("aria-expanded","false");
	$("#page").css("display", "block");
	executeSearchHtml();
});

let searchBottomText = $("#search-bottom-text");
$("#search-bottom-button").click(function() {
	$("#search_words").val(searchBottomText.val());
	$("#search_site_page").val(1);
	$("#search-top-text").val(searchBottomText.val());
	executeSearchHtml();
});

$('#search-bottom-text').on('keypress', function (e) {
    if(e.which === 13){
    	$("#search_words").val(searchBottomText.val());
    	if ( ($('#searchform_redirect').val()) != null ) {
    		$("#searchform_redirect").submit();
    	} else {
			$("#search_site_page").val(1);
        	$("#search-top-text").val(searchBottomText.val());
        	executeSearchHtml();
    	}    	
    }
});

const $code = $('#search-top-text');
$('#search-top-toggler').on('mousedown', function () {
    $(this).data('inputFocused', $code.is(":focus"));
}).click(function () {
    if ($(this).data('inputFocused')) {
        $code.blur();
    } else {
        $code.focus();
    }
});

$("#search-bottom-button-redirect").click(function() {
	$("#search_words").val(searchBottomText.val());
	$("#searchform_redirect").submit();
});

$("#search-top-button-redirect").click(function() {
	$("#search_words").val($("#search-top-text").val());
	$("#searchform_redirect").submit(); 
});

$("#search-mobile-button-redirect").click(function() {
	let $searchWords= $("#search_words");
	$searchWords.val($("#search-top-text").val());
	$searchWords.val($("#search-mobile-text").val());
	$("#searchform_redirect").submit();
});

