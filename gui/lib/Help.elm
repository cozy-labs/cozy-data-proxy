port module Help exposing (..)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import List
import String
import Helpers exposing (Helpers)


-- MODEL


type Status
    = Writing
    | Sending
    | Error String
    | Success


type alias Model =
    { body : Maybe String
    , status : Status
    }


defaultBody : List String
defaultBody =
    [ "Help Hello Cozy,"
    , "Help I like a lot what you do, but I have an issue:"
    , "Help [ The more you can say about the issue, the better: do you have many files? Are they big? Is your cozy up-to-date? ]"
    , "Help Take care!"
    ]


init : Model
init =
    { body = Nothing
    , status = Writing
    }



-- UPDATE


type Msg
    = FillBody String
    | SendMail
    | MailSent (Maybe String)


port sendMail : String -> Cmd msg


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case
        msg
    of
        FillBody body ->
            ( { model | body = Just body, status = Writing }, Cmd.none )

        SendMail ->
            let
                body =
                    case
                        model.body
                    of
                        Nothing ->
                            String.join "\n\n" defaultBody

                        Just body ->
                            body
            in
                ( { model | status = Sending }, sendMail body )

        MailSent Nothing ->
            ( { model | status = Success }, Cmd.none )

        MailSent (Just error) ->
            ( { model | status = (Error error) }, Cmd.none )



-- VIEW


view : Helpers -> Model -> Html Msg
view helpers model =
    let
        body =
            case
                model.body
            of
                Nothing ->
                    String.join "\n\n" (List.map helpers.t defaultBody)

                Just body ->
                    body
    in
        section [ class "two-panes__content two-panes__content--help" ]
            [ h1 [] [ text (helpers.t "Help Help") ]
            , h2 [] [ text (helpers.t "Help Community Support") ]
            , p [] [ text (helpers.t "Help Our community grows everyday and will be happy to give you an helping hand in one of these media:") ]
            , ul [ class "help-list" ]
                [ li []
                    [ a [ href "https://forum.cozy.io/" ]
                        [ i [ class "icon icon--forum" ] []
                        , text (helpers.t "Help Forum")
                        ]
                    ]
                , li []
                    [ a [ href "https://webchat.freenode.net/?channels=cozycloud" ]
                        [ i [ class "icon icon--irc" ] []
                        , text (helpers.t "Help IRC")
                        ]
                    ]
                , li []
                    [ a [ href "https://github.com/cozy" ]
                        [ i [ class "icon icon--github" ] []
                        , text (helpers.t "Help Github")
                        ]
                    ]
                ]
            , h2 [] [ text (helpers.t "Help Official Support") ]
            , p [] [ text (helpers.t "Help There are still a few more options to contact us:") ]
            , ul [ class "help-list" ]
                [ li []
                    [ a [ href "mailto:support@cozycloud.cc" ]
                        [ i [ class "icon icon--email" ] []
                        , text (helpers.t "Help Email")
                        ]
                    ]
                , li []
                    [ a [ href "https://twitter.com/intent/tweet?text=@mycozycloud%20" ]
                        [ i [ class "icon icon--twitter" ] []
                        , text (helpers.t "Help Twitter")
                        ]
                    ]
                , li []
                    [ a [ href "https://docs.cozy.io/en/" ]
                        [ i [ class "icon icon--documentation" ] []
                        , text (helpers.t "Help Documentation")
                        ]
                    ]
                ]
            ]
